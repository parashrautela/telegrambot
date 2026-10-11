import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { WORKFLOW_OPTIONS, WORKFLOWS, templateRecord } from './schema.js';
import { initializeOperations, operations } from './workspace-operations.js';
import { parseDependencyField } from './workflow-engine.js';
import { validDate } from './workspace-schedule.js';

export class WorkspaceError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const fail = (message, status) => { throw new WorkspaceError(message, status); };
const now = () => new Date().toISOString();
const id = () => randomUUID();
const digest = (token) => createHash('sha256').update(token).digest('hex');
const text = (value, label, max = 200) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(`${label} is required (maximum ${max} characters).`);
  return value.trim();
};
const url = (value) => {
  if (!value) return '';
  try { const parsed = new URL(value); if (parsed.protocol === 'https:' && !parsed.username && !parsed.password && value.length <= 2048) return parsed.href; } catch { /* invalid link */ }
  fail('Attachment links must use HTTPS without embedded credentials.');
};
const hashPassword = (password) => {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) fail('Use a password between 12 and 256 characters.');
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
};
const checkPassword = (password, hash) => {
  if (typeof password !== 'string' || password.length > 256) return false;
  const [salt, expected] = hash.split(':');
  return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(expected, 'hex'));
};
const publicUser = (user) => ({ id: user.id, name: user.name, role: user.role, active: Boolean(user.active) });

export class WorkspaceStore {
  constructor(filename = 'data/workspace.sqlite') {
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(filename);
    if (filename !== ':memory:') chmodSync(filename, 0o600);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY COLLATE NOCASE, name TEXT NOT NULL, role TEXT NOT NULL, passwordHash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS sessions (tokenHash TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id), expiresAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS clients (id TEXT PRIMARY KEY, name TEXT NOT NULL, telegramId TEXT NOT NULL DEFAULT '');
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, clientId TEXT NOT NULL REFERENCES clients(id), location TEXT NOT NULL DEFAULT '', workflowId TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'Setup', telegramProjectId TEXT UNIQUE, groupChatId TEXT UNIQUE, createdAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS memberships (projectId TEXT NOT NULL REFERENCES projects(id), userId TEXT NOT NULL REFERENCES users(id), PRIMARY KEY(projectId,userId));
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id), title TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'Task', stage TEXT NOT NULL DEFAULT '', ownerId TEXT REFERENCES users(id), status TEXT NOT NULL DEFAULT 'Open', decision TEXT NOT NULL DEFAULT '', blocker TEXT NOT NULL DEFAULT '', nextAction TEXT NOT NULL DEFAULT '', createdAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages (seq INTEGER PRIMARY KEY AUTOINCREMENT, taskId TEXT NOT NULL REFERENCES tasks(id), authorId TEXT NOT NULL REFERENCES users(id), body TEXT NOT NULL, attachmentUrl TEXT NOT NULL DEFAULT '', createdAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reads (taskId TEXT NOT NULL REFERENCES tasks(id), userId TEXT NOT NULL REFERENCES users(id), lastSeq INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(taskId,userId));
      CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id), type TEXT NOT NULL, body TEXT NOT NULL, context TEXT NOT NULL DEFAULT '', sender TEXT NOT NULL, source TEXT NOT NULL, sourceMessageId TEXT NOT NULL DEFAULT '', sourceMetadata TEXT NOT NULL DEFAULT '{}', attachments TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'Pending', taskId TEXT REFERENCES tasks(id), reviewNote TEXT NOT NULL DEFAULT '', createdAt TEXT NOT NULL, reviewedAt TEXT);
      CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id), projectId TEXT NOT NULL REFERENCES projects(id), taskId TEXT REFERENCES tasks(id), kind TEXT NOT NULL, body TEXT NOT NULL, readAt TEXT, createdAt TEXT NOT NULL, requestId TEXT REFERENCES requests(id), messageSeq INTEGER REFERENCES messages(seq));
      CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY, actorId TEXT NOT NULL, projectId TEXT, action TEXT NOT NULL, details TEXT NOT NULL, createdAt TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS message_thread ON messages(taskId,seq);
      CREATE INDEX IF NOT EXISTS notification_user ON notifications(userId,createdAt);
      CREATE INDEX IF NOT EXISTS request_project ON requests(projectId,status);
    `);
    // Additive migrations preserve databases created during the first preview.
    const requestColumns = this.all('PRAGMA table_info(requests)').map((column) => column.name);
    if (!requestColumns.includes('sourceMetadata')) this.db.exec("ALTER TABLE requests ADD COLUMN sourceMetadata TEXT NOT NULL DEFAULT '{}'");
    const notificationColumns = this.all('PRAGMA table_info(notifications)').map((column) => column.name);
    if (!notificationColumns.includes('requestId')) this.db.exec('ALTER TABLE notifications ADD COLUMN requestId TEXT REFERENCES requests(id)');
    if (!notificationColumns.includes('messageSeq')) this.db.exec('ALTER TABLE notifications ADD COLUMN messageSeq INTEGER REFERENCES messages(seq)');
    initializeOperations(this);
    // Equal-cost password verification also applies to unknown logins.
    this.dummyHash = hashPassword(randomBytes(24).toString('hex'));
  }
  close() { this.db.close(); }
  all(sql, ...args) { return this.db.prepare(sql).all(...args); }
  get(sql, ...args) { return this.db.prepare(sql).get(...args); }
  run(sql, ...args) { return this.db.prepare(sql).run(...args); }
  transaction(work) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  audit(actorId, projectId, action, details = '') {
    this.run('INSERT INTO audit VALUES (?,?,?,?,?,?)', id(), actorId, projectId, action, details, now());
  }
  bootstrap(staffId, password, name = 'Studio founder') {
    if (this.get('SELECT id FROM users LIMIT 1')) return;
    if (!staffId || !password) fail('First start requires WORKSPACE_FOUNDER_ID and WORKSPACE_FOUNDER_PASSWORD.');
    const userId = this.staffId(staffId);
    this.run('INSERT INTO users VALUES (?,?,?,?,1)', userId, text(name, 'Name'), 'Founder', hashPassword(password));
  }
  staffId(value) {
    const result = text(value, 'Staff ID', 64).toLowerCase();
    if (!/^[a-z0-9._-]+$/.test(result)) fail('Staff IDs use letters, numbers, dots, underscores, or hyphens.');
    return result;
  }
  login(staffId, password) {
    const user = typeof staffId === 'string' ? this.get('SELECT * FROM users WHERE id = ?', staffId.trim().toLowerCase()) : undefined;
    const valid = checkPassword(password, user?.passwordHash || this.dummyHash);
    if (!valid || !user?.active) fail('Staff ID or password is incorrect.', 401);
    this.run('DELETE FROM sessions WHERE expiresAt <= ?', Date.now());
    const token = randomBytes(32).toString('hex');
    this.run('INSERT INTO sessions VALUES (?,?,?)', digest(token), user.id, Date.now() + 1000 * 60 * 60 * 12);
    return { token, user: publicUser(user) };
  }
  authenticate(token) {
    const user = token && this.get('SELECT u.* FROM users u JOIN sessions s ON u.id=s.userId WHERE s.tokenHash=? AND s.expiresAt>? AND u.active=1', digest(token), Date.now());
    if (!user) fail('Please sign in.', 401);
    return publicUser(user);
  }
  logout(token) { if (token) this.run('DELETE FROM sessions WHERE tokenHash=?', digest(token)); }
  founder(user) { if (user.role !== 'Founder') fail('Only the founder can perform this action.', 403); }
  project(user, projectId) {
    const project = this.get('SELECT * FROM projects WHERE id=?', projectId);
    if (!project || (user.role !== 'Founder' && !this.get('SELECT 1 FROM memberships WHERE projectId=? AND userId=?', projectId, user.id))) fail('Project not found or access revoked.', 404);
    return project;
  }
  task(user, taskId) {
    const task = this.get('SELECT * FROM tasks WHERE id=?', taskId);
    if (!task) fail('Task not found.', 404);
    this.project(user, task.projectId);
    return task;
  }
  owner(projectId, ownerId) {
    const owner = this.get('SELECT * FROM users WHERE id=? AND active=1', ownerId);
    if (!owner || (owner.role !== 'Founder' && !this.get('SELECT 1 FROM memberships WHERE projectId=? AND userId=?', projectId, ownerId))) fail('Choose an active member of this project as owner.');
    return owner;
  }
  createUser(user, input) {
    this.founder(user);
    const staffId = this.staffId(input.id);
    if (this.get('SELECT id FROM users WHERE id=?', staffId)) fail('That staff ID already exists.', 409);
    if (!['Designer', 'Site supervisor', 'Project lead', 'Employee'].includes(input.role)) fail('Choose a valid staff role.');
    this.run('INSERT INTO users VALUES (?,?,?,?,1)', staffId, text(input.name, 'Name'), input.role, hashPassword(input.password));
    this.audit(user.id, null, 'Staff account created', staffId);
    return { id: staffId };
  }
  disableUser(user, userId) {
    this.founder(user);
    const target = this.get('SELECT * FROM users WHERE id=?', userId);
    if (!target || target.role === 'Founder') fail('Only employee accounts can be disabled.');
    this.transaction(() => {
      this.run('UPDATE users SET active=0 WHERE id=?', userId);
      this.run('DELETE FROM sessions WHERE userId=?', userId);
      this.run('UPDATE tasks SET ownerId=NULL WHERE ownerId=?', userId);
      this.audit(user.id, null, 'Staff account disabled', userId);
    });
  }
  createClient(user, input) {
    this.founder(user);
    const clientId = id();
    const telegramId = input.telegramId ? text(input.telegramId, 'Telegram ID', 30) : '';
    if (telegramId && !/^\d+$/.test(telegramId)) fail('Telegram user IDs must be numeric.');
    this.run('INSERT INTO clients VALUES (?,?,?)', clientId, text(input.name, 'Client name'), telegramId);
    this.audit(user.id, null, 'Client added', clientId);
    return { id: clientId };
  }
  createProject(user, input) {
    this.founder(user);
    if (!this.get('SELECT id FROM clients WHERE id=?', input.clientId || '')) fail('Assign a client before creating a project.');
    const projectId = id();
    const name = text(input.name, 'Project name');
    const location = typeof input.location === 'string' ? input.location.trim().slice(0, 200) : '';
    const telegramProjectId = input.telegramProjectId ? text(input.telegramProjectId, 'Telegram project ID', 80) : null;
    const groupChatId = input.groupChatId ? text(input.groupChatId, 'Telegram group ID', 30) : null;
    if (groupChatId && !/^-\d+$/.test(groupChatId)) fail('Telegram group IDs must be negative numbers.');
    if (telegramProjectId && !groupChatId) fail('Provide the Telegram group ID alongside the bot project ID.');
    if (groupChatId && !telegramProjectId) fail('Provide the bot project ID alongside the Telegram group ID.');
    if (telegramProjectId && this.get('SELECT id FROM projects WHERE telegramProjectId=? OR groupChatId=?', telegramProjectId, groupChatId)) fail('That Telegram project or group is already linked.', 409);
    this.transaction(() => {
      this.run('INSERT INTO projects(id,name,clientId,location,telegramProjectId,groupChatId,createdAt) VALUES (?,?,?,?,?,?,?)', projectId, name, input.clientId, location, telegramProjectId, groupChatId, now());
      this.run('INSERT INTO memberships VALUES (?,?)', projectId, user.id);
      this.audit(user.id, projectId, 'Project created', input.clientId);
    });
    return { id: projectId };
  }
  setMember(user, projectId, userId, add) {
    this.founder(user); this.project(user, projectId);
    const member = this.get('SELECT * FROM users WHERE id=? AND active=1', userId);
    if (!member || member.role === 'Founder') fail('Choose an active employee.');
    this.transaction(() => {
      if (add) this.run('INSERT OR IGNORE INTO memberships VALUES (?,?)', projectId, userId);
      else {
        this.run('DELETE FROM memberships WHERE projectId=? AND userId=?', projectId, userId);
        this.run('UPDATE tasks SET ownerId=NULL WHERE projectId=? AND ownerId=?', projectId, userId);
        // A re-added member starts without stale notifications or read state.
        this.run('DELETE FROM notifications WHERE projectId=? AND userId=?', projectId, userId);
        this.run('DELETE FROM reads WHERE userId=? AND taskId IN (SELECT id FROM tasks WHERE projectId=?)', userId, projectId);
      }
      this.audit(user.id, projectId, add ? 'Project access granted' : 'Project access revoked', userId);
    });
  }
  activate(user, projectId, input) {
    this.founder(user);
    const project = this.project(user, projectId);
    if (!this.get('SELECT id FROM clients WHERE id=?', project.clientId)) fail('Assign a client before starting work.');
    const template = WORKFLOWS[input.workflowId];
    if (!template) fail('Choose a valid workflow.');
    if (project.status === 'Active') {
      if (project.workflowId !== input.workflowId) fail('This project already has a workflow.', 409);
      return { id: projectId }; // activation retries are safe
    }
    const owner = this.owner(projectId, input.ownerId || user.id);
    const startDate = input.startDate || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    if (!validDate(startDate)) fail('Use a valid start date.');
    this.transaction(() => {
      const generated = new Map();
      for (const step of template) {
        const record = templateRecord(step);
        const role = record.DefaultRole;
        const staff = this.all('SELECT u.id,u.role FROM users u JOIN memberships m ON m.userId=u.id WHERE m.projectId=? AND u.active=1', projectId);
        const matched = staff.find(s => s.role === role || role === 'Site Supervisor' && s.role === 'Site supervisor');
        const taskId = this.insertTask(projectId, record.TaskName, 'Task', matched?.id || owner.id, record.Stage);
        generated.set(String(record.Sequence), taskId);
        this.run('UPDATE tasks SET durationDays=?,gateType=? WHERE id=?', record.DurationDays === '' ? null : Number(record.DurationDays), record.GateType || '', taskId);
      }
      for (const step of template) {
        const record = templateRecord(step);
        for (const edge of parseDependencyField(record.DependencySequences, record.PredecessorTemplateID)) {
          this.run('INSERT INTO dependencies VALUES (?,?,?)', generated.get(String(record.Sequence)), generated.get(String(edge.sequence)), edge.type);
        }
      }
      this.run("UPDATE projects SET workflowId=?,status='Active',startDate=? WHERE id=?", input.workflowId, startDate, projectId);
      this.recalculate(projectId);
      this.run('UPDATE tasks SET baselineStart=forecastStart,baselineEnd=forecastEnd WHERE projectId=?', projectId);
      this.event(user, projectId, null, 'Project started', 'Work plan created.');
      this.audit(user.id, projectId, 'Internal workflow activated', input.workflowId);
    });
    return { id: projectId };
  }
  insertTask(projectId, title, kind, ownerId, stage = '') {
    const taskId = id();
    this.run('INSERT INTO tasks(id,projectId,title,kind,stage,ownerId,nextAction,createdAt) VALUES (?,?,?,?,?,?,?,?)', taskId, projectId, title, kind, stage, ownerId, kind === 'Query' ? 'Review the question and record a decision.' : 'Review the brief and agree on the next step.', now());
    return taskId;
  }
  createTask(user, projectId, input) {
    this.founder(user);
    const project = this.project(user, projectId);
    if (project.status !== 'Active') fail('Choose a workflow and activate this project first.');
    const owner = this.owner(projectId, input.ownerId);
    const title = text(input.title, 'Task title');
    if (!['Task', 'Query'].includes(input.kind)) fail('Choose Task or Query.');
    return this.transaction(() => {
      const taskId = this.insertTask(projectId, title, input.kind, owner.id);
      this.notify(owner.id, projectId, taskId, 'Assignment', `You were assigned: ${title}`, user.id);
      this.audit(user.id, projectId, 'Work assigned', taskId);
      return { id: taskId };
    });
  }
  intake(projectId, input) {
    const requestId = text(input.id, 'Request ID', 200);
    const existing = this.get('SELECT * FROM requests WHERE id=?', requestId);
    if (existing) {
      if (existing.projectId !== projectId) fail('Request belongs to another project.', 409);
      return existing;
    }
    if (!['Question', 'Approval'].includes(input.type)) fail('Choose Question or Approval.');
    const body = text(input.body, 'Request text', 10000);
    const sender = text(input.sender, 'Sender', 200);
    const context = typeof input.context === 'string' ? input.context.slice(0, 10000) : '';
    const items = input.attachments || [];
    if (!Array.isArray(items) || items.length > 50 || items.some((item) => !item || typeof item !== 'object' || typeof item.type !== 'string'
      || ['type', 'fileId', 'fileName', 'mimeType', 'url'].some((key) => item[key] !== undefined && (typeof item[key] !== 'string' || item[key].length > 2048)))) fail('Invalid attachments.');
    const attachments = JSON.stringify(items);
    if (attachments.length > 20000) fail('Invalid attachments.');
    this.transaction(() => {
      this.run('INSERT INTO requests(id,projectId,type,body,context,sender,source,sourceMessageId,sourceMetadata,attachments,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)', requestId, projectId, input.type, body, context, sender, input.source, String(input.sourceMessageId || ''), JSON.stringify(input.sourceMetadata || {}), attachments, now());
      const founders = this.all("SELECT id FROM users WHERE active=1 AND role='Founder'");
      for (const founder of founders) this.notify(founder.id, projectId, null, 'Client request', `${sender}: ${body.slice(0, 160)}`, '', requestId);
      this.audit(input.source === 'Telegram' ? 'Telegram integration' : input.actorId, projectId, 'Client request received', requestId);
      this.openIntervention(projectId, null, input.type, body, sender, requestId);
      this.event({ name: sender }, projectId, null, 'Question', body);
    });
    return this.get('SELECT * FROM requests WHERE id=?', requestId);
  }
  manualRequest(user, projectId, input) {
    this.founder(user); this.project(user, projectId);
    return this.intake(projectId, { ...input, id: id(), source: 'Manual', actorId: user.id, attachments: input.attachmentUrl ? [{ type: 'Link', url: url(input.attachmentUrl) }] : [] });
  }
  telegramRequest(input) {
    const project = this.get('SELECT * FROM projects WHERE telegramProjectId=? AND groupChatId=?', String(input.TelegramProjectID || ''), String(input.GroupChatID || ''));
    if (!project) fail('Link this bot project and group to a workspace project first.', 404);
    let attachments;
    try { attachments = JSON.parse(input.AttachmentsJSON || '[]'); } catch { fail('Invalid attachment metadata.'); }
    const alreadyCaptured = this.get('SELECT id FROM requests WHERE id=?', input.RequestID);
    const request = this.intake(project.id, {
      id: input.RequestID, type: input.RequestType, body: input.OriginalMessage || input.RequestContext || 'Client attachment for review',
      context: input.RequestContext, sender: input.OriginalSenderName || input.RequestedByName || 'Client', source: 'Telegram', sourceMessageId: input.SourceMessageID, attachments,
      sourceMetadata: {
        originalSenderTelegramId: String(input.OriginalSenderTelegramID || ''), requestedByTelegramId: String(input.RequestedByTelegramID || ''),
        requestedByName: String(input.RequestedByName || ''), requestedByRole: String(input.RequestedByRole || ''),
        commandMessageId: String(input.CommandMessageID || ''), sourceCreatedAt: String(input.CreatedAt || ''),
      },
    });
    const assigned = this.all("SELECT * FROM tasks WHERE projectId=? AND externalTelegramId=? AND status!='Resolved'", project.id, String(input.OriginalSenderTelegramID || ''));
    if (assigned.length === 1 && input.OriginalSenderTelegramID) {
      this.run('UPDATE requests SET taskId=? WHERE id=?', assigned[0].id, request.id);
      this.run('UPDATE interventions SET taskId=? WHERE requestId=?', assigned[0].id, request.id);
      const photoIndex = attachments.findIndex(a => a.type === 'Photo');
      if (!alreadyCaptured && photoIndex >= 0 && /\b(done|completed|finished)\b/i.test(request.body) && assigned[0].status !== 'Awaiting review') {
        this.transaction(() => {
          this.run('INSERT INTO submissions(id,taskId,evidenceUrl,note,createdAt) VALUES (?,?,?,?,?)', id(), assigned[0].id, `/api/workspace/requests/${encodeURIComponent(request.id)}/attachments/${photoIndex}`, request.body, now());
          this.run("UPDATE tasks SET status='Awaiting review',version=version+1 WHERE id=?", assigned[0].id);
          this.run("UPDATE interventions SET kind='Review',title='Work ready for your review' WHERE requestId=?", request.id);
        });
      }
    }
    return { request: { id: request.id, status: request.status } };
  }
  reviewRequest(user, requestId, input) {
    this.founder(user);
    const request = this.get('SELECT * FROM requests WHERE id=?', requestId);
    if (!request) fail('Request not found.', 404);
    const project = this.project(user, request.projectId);
    if (!['Approved', 'Rejected', 'Clarification'].includes(input.status)) fail('Invalid review decision.');
    if (['Approved', 'Resolved', 'Rejected'].includes(request.status)) {
      if (request.status === input.status || (request.status === 'Resolved' && input.status === 'Approved')) return { taskId: request.taskId };
      fail('This request has already been reviewed.', 409);
    }
    const note = input.status === 'Approved' ? String(input.note || '').slice(0, 2000) : text(input.note, 'Review note', 2000);
    if (input.status === 'Approved' && project.status !== 'Active') fail('Activate this project before assigning client work.');
    const owner = input.status === 'Approved' ? this.owner(project.id, input.ownerId) : null;
    let taskId = null;
    return this.transaction(() => {
      if (owner) {
        if (input.taskId) {
          const task = this.task(user, input.taskId);
          if (task.projectId !== project.id || task.status === 'Resolved') fail('Choose an open task in this project.');
          taskId = task.id;
          this.run('UPDATE tasks SET ownerId=? WHERE id=?', owner.id, taskId);
        } else {
          taskId = this.insertTask(project.id, text(input.title, 'Task/query title'), request.type === 'Question' ? 'Query' : 'Task', owner.id);
        }
        this.notify(owner.id, project.id, taskId, 'Assignment', `Client request assigned: ${request.body.slice(0, 120)}`, user.id);
      }
      this.run('UPDATE requests SET status=?,taskId=?,reviewNote=?,reviewedAt=? WHERE id=?', input.status, taskId, note, now(), requestId);
      this.run('UPDATE interventions SET taskId=COALESCE(?,taskId),status=?,version=version+1 WHERE requestId=?', taskId, input.status === 'Rejected' ? 'Resolved' : 'Open', requestId);
      this.run('UPDATE notifications SET readAt=? WHERE requestId=? AND userId=?', now(), requestId, user.id);
      this.audit(user.id, project.id, `Request ${input.status.toLowerCase()}`, requestId);
      return { taskId };
    });
  }
  notify(userId, projectId, taskId, kind, body, actorId = '', requestId = null, messageSeq = null) {
    if (userId === actorId) return;
    this.run('INSERT INTO notifications(id,userId,projectId,taskId,kind,body,createdAt,requestId,messageSeq) VALUES (?,?,?,?,?,?,?,?,?)', id(), userId, projectId, taskId, kind, body, now(), requestId, messageSeq);
  }
  thread(user, taskId) {
    const task = this.task(user, taskId);
    return {
      task,
      messages: this.all('SELECT m.*,u.name AS authorName,u.role AS authorRole FROM messages m JOIN users u ON u.id=m.authorId WHERE taskId=? ORDER BY seq', taskId),
      requests: this.all("SELECT id,type,body,context,sender,source,attachments,status FROM requests WHERE taskId=? AND status IN ('Approved','Resolved')", taskId).map((r) => ({ ...r, attachments: JSON.parse(r.attachments) })),
    };
  }
  postMessage(user, taskId, input) {
    const task = this.task(user, taskId);
    if (task.status === 'Resolved') fail('This thread is resolved. Reopen it before replying.', 409);
    const body = text(input.body, 'Message', 10000);
    const attachmentUrl = url(input.attachmentUrl);
    return this.transaction(() => {
      const result = this.run('INSERT INTO messages(taskId,authorId,body,attachmentUrl,createdAt) VALUES (?,?,?,?,?)', taskId, user.id, body, attachmentUrl, now());
      const recipients = this.all("SELECT u.id FROM users u WHERE u.active=1 AND (u.role='Founder' OR EXISTS(SELECT 1 FROM memberships p WHERE p.projectId=? AND p.userId=u.id))", task.projectId);
      for (const recipient of recipients) this.notify(recipient.id, task.projectId, taskId, 'Message', `${user.name}: ${body.slice(0, 160)}`, user.id, null, Number(result.lastInsertRowid));
      this.audit(user.id, task.projectId, 'Internal message posted', `${taskId}:${result.lastInsertRowid}`);
      this.event(user, task.projectId, taskId, 'Discussion', body);
      return { seq: Number(result.lastInsertRowid) };
    });
  }
  readThread(user, taskId, lastSeq) {
    this.task(user, taskId);
    if (!Number.isSafeInteger(lastSeq) || lastSeq < 0) fail('Invalid read position.');
    const maximum = Number(this.get('SELECT COALESCE(MAX(seq),0) AS seq FROM messages WHERE taskId=?', taskId).seq);
    if (lastSeq > maximum || (lastSeq !== 0 && !this.get('SELECT seq FROM messages WHERE taskId=? AND seq=?', taskId, lastSeq))) fail('Read position must belong to this thread.');
    this.run('INSERT INTO reads VALUES (?,?,?) ON CONFLICT(taskId,userId) DO UPDATE SET lastSeq=MAX(reads.lastSeq,excluded.lastSeq)', taskId, user.id, lastSeq);
    this.run('UPDATE notifications SET readAt=? WHERE userId=? AND taskId=? AND messageSeq<=? AND readAt IS NULL', now(), user.id, taskId, lastSeq);
  }
  readNotification(user, notificationId) {
    const notification = this.get('SELECT * FROM notifications WHERE id=? AND userId=?', notificationId, user.id);
    if (!notification) fail('Notification not found.', 404);
    this.project(user, notification.projectId);
    this.run('UPDATE notifications SET readAt=? WHERE id=?', now(), notificationId);
  }
  updateTask(user, taskId, input) {
    const task = this.task(user, taskId);
    if (user.role !== 'Founder' && task.ownerId !== user.id) fail('Only the task owner or founder can update this work.', 403);
    const status = input.status || task.status;
    if (input.version !== undefined && input.version !== task.version) fail('This work changed. Refresh before updating.', 409);
    if (task.status === 'Resolved' && status !== 'Resolved') this.founder(user);
    if (!['Open', 'In progress', 'Blocked', 'Resolved', 'Rework required'].includes(status)) fail('Choose a valid status.');
    if (status === 'Resolved' && task.status !== 'Resolved') fail('Submit evidence and use founder review to complete this work.');
    if (status === 'In progress' && task.status !== 'In progress') {
      if (task.dependencyBlocker) fail(task.dependencyBlocker);
      if (this.get('SELECT 1 FROM requirements WHERE taskId=? AND verified=0', taskId)) fail('Required inputs need verification.');
    }
    const fields = ['decision', 'blocker', 'nextAction'].map((key) => input[key] === undefined ? task[key] : (typeof input[key] === 'string' && input[key].length <= 2000 ? input[key].trim() : fail('Summary fields must be under 2000 characters.')));
    let ownerId = task.ownerId;
    if (input.ownerId !== undefined) { this.founder(user); ownerId = this.owner(task.projectId, input.ownerId).id; }
    this.transaction(() => {
      this.run('UPDATE tasks SET status=?,decision=?,blocker=?,nextAction=?,ownerId=? WHERE id=?', status, ...fields, ownerId, taskId);
      if (task.status === 'Resolved' && status !== 'Resolved') this.run("UPDATE tasks SET actualEnd='' WHERE id=?", taskId);
      this.run("UPDATE tasks SET version=version+1,actualStart=CASE WHEN ?='In progress' AND actualStart='' THEN ? ELSE actualStart END WHERE id=?", status, new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()), taskId);
      this.recalculate(task.projectId);
      this.event(user, task.projectId, taskId, 'Progress', `${task.title}: ${status}. ${fields[2]}`);
      if (ownerId && ownerId !== task.ownerId) this.notify(ownerId, task.projectId, taskId, 'Assignment', `You were assigned: ${task.title}`, user.id);
      this.audit(user.id, task.projectId, 'Task updated', `${taskId}: ${status}`);
    });
  }
  snapshot(user) {
    const projects = this.all("SELECT p.*,c.name AS clientName FROM projects p JOIN clients c ON c.id=p.clientId WHERE ?='Founder' OR EXISTS (SELECT 1 FROM memberships m WHERE m.projectId=p.id AND m.userId=?) ORDER BY p.createdAt DESC", user.role, user.id);
    const tasks = projects.flatMap((project) => this.all(`SELECT t.*,u.name AS ownerName,
      (SELECT COUNT(*) FROM messages m WHERE m.taskId=t.id AND m.authorId!=? AND m.seq>COALESCE((SELECT lastSeq FROM reads r WHERE r.taskId=t.id AND r.userId=?),0)) AS unread,
      COALESCE((SELECT MAX(createdAt) FROM messages m WHERE m.taskId=t.id),t.createdAt) AS lastActivity
      FROM tasks t LEFT JOIN users u ON u.id=t.ownerId WHERE t.projectId=? ORDER BY lastActivity DESC`, user.id, user.id, project.id));
    const memberships = projects.flatMap((project) => this.all('SELECT projectId,userId FROM memberships WHERE projectId=?', project.id));
    const users = user.role === 'Founder' ? this.all('SELECT id,name,role,active FROM users ORDER BY name') : this.all("SELECT DISTINCT u.id,u.name,u.role,u.active FROM users u WHERE u.active=1 AND (u.role='Founder' OR EXISTS(SELECT 1 FROM memberships m JOIN memberships mine ON mine.projectId=m.projectId WHERE m.userId=u.id AND mine.userId=?))", user.id);
    const notifications = this.all("SELECT n.* FROM notifications n WHERE n.userId=? AND (?='Founder' OR EXISTS(SELECT 1 FROM memberships m WHERE m.projectId=n.projectId AND m.userId=?)) ORDER BY (n.readAt IS NULL) DESC,n.createdAt DESC LIMIT 100", user.id, user.role, user.id);
    const notificationUnread = this.get("SELECT COUNT(*) AS count FROM notifications n WHERE n.userId=? AND n.readAt IS NULL AND (?='Founder' OR EXISTS(SELECT 1 FROM memberships m WHERE m.projectId=n.projectId AND m.userId=?))", user.id, user.role, user.id).count;
    const requests = user.role === 'Founder' ? this.all('SELECT * FROM requests ORDER BY createdAt DESC').map((r) => ({ ...r, attachments: JSON.parse(r.attachments) })) : [];
    return this.enrichSnapshot(user, {
      user, users: users.map(publicUser), projects: projects.map((p) => ({ ...p, unread: tasks.filter((t) => t.projectId === p.id).reduce((sum, t) => sum + t.unread, 0) })),
      tasks, memberships, requests, notifications, notificationUnread,
      clients: user.role === 'Founder' ? this.all('SELECT * FROM clients ORDER BY name') : [],
      workflows: WORKFLOW_OPTIONS.map((w) => ({ ...w, taskCount: WORKFLOWS[w.id].length })),
    });
  }
}
Object.assign(WorkspaceStore.prototype, operations);
