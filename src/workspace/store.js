import { openWorkspaceDatabase } from './database.js';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { WORKFLOW_OPTIONS, WORKFLOWS, templateRecord } from '../workflow/schema.js';

export class WorkspaceError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const fail = (message, status) => {
  throw new WorkspaceError(message, status);
};
const now = () => new Date().toISOString();
const id = () => randomUUID();
const digest = (token) => createHash('sha256').update(token).digest('hex');
const text = (value, label, max = 200) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
    fail(`${label} is required (maximum ${max} characters).`);
  return value.trim();
};
const url = (value) => {
  if (!value) return '';
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol === 'https:' &&
      !parsed.username &&
      !parsed.password &&
      value.length <= 2048
    )
      return parsed.href;
  } catch {
    /* invalid link */
  }
  fail('Attachment links must use HTTPS without embedded credentials.');
};
const hashPassword = (password) => {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256)
    fail('Use a password between 12 and 256 characters.');
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
};
const checkPassword = (password, hash) => {
  if (typeof password !== 'string' || password.length > 256) return false;
  const [salt, expected] = hash.split(':');
  return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(expected, 'hex'));
};
const publicUser = (user) => ({
  id: user.id,
  name: user.name,
  role: user.role,
  active: Boolean(user.active),
});

export class WorkspaceStore {
  constructor(filename = 'data/workspace.sqlite') {
    this.db = openWorkspaceDatabase(filename);
    // Equal-cost password verification also applies to unknown logins.
    this.dummyHash = hashPassword(randomBytes(24).toString('hex'));
  }
  close() {
    this.db.close();
  }
  all(sql, ...args) {
    return this.db.prepare(sql).all(...args);
  }
  get(sql, ...args) {
    return this.db.prepare(sql).get(...args);
  }
  run(sql, ...args) {
    return this.db.prepare(sql).run(...args);
  }
  transaction(work) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  audit(actorId, projectId, action, details = '') {
    this.run(
      'INSERT INTO audit VALUES (?,?,?,?,?,?)',
      id(),
      actorId,
      projectId,
      action,
      details,
      now(),
    );
  }
  bootstrap(staffId, password, name = 'Studio founder') {
    if (this.get('SELECT id FROM users LIMIT 1')) return;
    if (!staffId || !password)
      fail('First start requires WORKSPACE_FOUNDER_ID and WORKSPACE_FOUNDER_PASSWORD.');
    const userId = this.staffId(staffId);
    this.run(
      'INSERT INTO users VALUES (?,?,?,?,1)',
      userId,
      text(name, 'Name'),
      'Founder',
      hashPassword(password),
    );
  }
  staffId(value) {
    const result = text(value, 'Staff ID', 64).toLowerCase();
    if (!/^[a-z0-9._-]+$/.test(result))
      fail('Staff IDs use letters, numbers, dots, underscores, or hyphens.');
    return result;
  }
  login(staffId, password) {
    const user =
      typeof staffId === 'string'
        ? this.get('SELECT * FROM users WHERE id = ?', staffId.trim().toLowerCase())
        : undefined;
    const valid = checkPassword(password, user?.passwordHash || this.dummyHash);
    if (!valid || !user?.active) fail('Staff ID or password is incorrect.', 401);
    this.run('DELETE FROM sessions WHERE expiresAt <= ?', Date.now());
    const token = randomBytes(32).toString('hex');
    this.run(
      'INSERT INTO sessions VALUES (?,?,?)',
      digest(token),
      user.id,
      Date.now() + 1000 * 60 * 60 * 12,
    );
    return { token, user: publicUser(user) };
  }
  authenticate(token) {
    const user =
      token &&
      this.get(
        'SELECT u.* FROM users u JOIN sessions s ON u.id=s.userId WHERE s.tokenHash=? AND s.expiresAt>? AND u.active=1',
        digest(token),
        Date.now(),
      );
    if (!user) fail('Please sign in.', 401);
    return publicUser(user);
  }
  logout(token) {
    if (token) this.run('DELETE FROM sessions WHERE tokenHash=?', digest(token));
  }
  founder(user) {
    if (user.role !== 'Founder') fail('Only the founder can perform this action.', 403);
  }
  project(user, projectId) {
    const project = this.get('SELECT * FROM projects WHERE id=?', projectId);
    if (
      !project ||
      (user.role !== 'Founder' &&
        !this.get('SELECT 1 FROM memberships WHERE projectId=? AND userId=?', projectId, user.id))
    )
      fail('Project not found or access revoked.', 404);
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
    if (
      !owner ||
      (owner.role !== 'Founder' &&
        !this.get('SELECT 1 FROM memberships WHERE projectId=? AND userId=?', projectId, ownerId))
    )
      fail('Choose an active member of this project as owner.');
    return owner;
  }
  createUser(user, input) {
    this.founder(user);
    const staffId = this.staffId(input.id);
    if (this.get('SELECT id FROM users WHERE id=?', staffId))
      fail('That staff ID already exists.', 409);
    if (!['Designer', 'Project lead', 'Employee'].includes(input.role))
      fail('Choose a valid staff role.');
    this.run(
      'INSERT INTO users VALUES (?,?,?,?,1)',
      staffId,
      text(input.name, 'Name'),
      input.role,
      hashPassword(input.password),
    );
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
    this.run(
      'INSERT INTO clients VALUES (?,?,?)',
      clientId,
      text(input.name, 'Client name'),
      telegramId,
    );
    this.audit(user.id, null, 'Client added', clientId);
    return { id: clientId };
  }
  createProject(user, input) {
    this.founder(user);
    if (!this.get('SELECT id FROM clients WHERE id=?', input.clientId || ''))
      fail('Assign a client before creating a project.');
    const projectId = id();
    const name = text(input.name, 'Project name');
    const location = typeof input.location === 'string' ? input.location.trim().slice(0, 200) : '';
    const telegramProjectId = input.telegramProjectId
      ? text(input.telegramProjectId, 'Telegram project ID', 80)
      : null;
    const groupChatId = input.groupChatId ? text(input.groupChatId, 'Telegram group ID', 30) : null;
    if (groupChatId && !/^-\d+$/.test(groupChatId))
      fail('Telegram group IDs must be negative numbers.');
    if (telegramProjectId && !groupChatId)
      fail('Provide the Telegram group ID alongside the bot project ID.');
    if (groupChatId && !telegramProjectId)
      fail('Provide the bot project ID alongside the Telegram group ID.');
    if (
      telegramProjectId &&
      this.get(
        'SELECT id FROM projects WHERE telegramProjectId=? OR groupChatId=?',
        telegramProjectId,
        groupChatId,
      )
    )
      fail('That Telegram project or group is already linked.', 409);
    this.transaction(() => {
      this.run(
        'INSERT INTO projects(id,name,clientId,location,telegramProjectId,groupChatId,createdAt) VALUES (?,?,?,?,?,?,?)',
        projectId,
        name,
        input.clientId,
        location,
        telegramProjectId,
        groupChatId,
        now(),
      );
      this.run('INSERT INTO memberships VALUES (?,?)', projectId, user.id);
      this.audit(user.id, projectId, 'Project created', input.clientId);
    });
    return { id: projectId };
  }
  setMember(user, projectId, userId, add) {
    this.founder(user);
    this.project(user, projectId);
    const member = this.get('SELECT * FROM users WHERE id=? AND active=1', userId);
    if (!member || member.role === 'Founder') fail('Choose an active employee.');
    this.transaction(() => {
      if (add) this.run('INSERT OR IGNORE INTO memberships VALUES (?,?)', projectId, userId);
      else {
        this.run('DELETE FROM memberships WHERE projectId=? AND userId=?', projectId, userId);
        this.run(
          'UPDATE tasks SET ownerId=NULL WHERE projectId=? AND ownerId=?',
          projectId,
          userId,
        );
        // A re-added member starts without stale notifications or read state.
        this.run('DELETE FROM notifications WHERE projectId=? AND userId=?', projectId, userId);
        this.run(
          'DELETE FROM reads WHERE userId=? AND taskId IN (SELECT id FROM tasks WHERE projectId=?)',
          userId,
          projectId,
        );
      }
      this.audit(
        user.id,
        projectId,
        add ? 'Project access granted' : 'Project access revoked',
        userId,
      );
    });
  }
  activate(user, projectId, input) {
    this.founder(user);
    const project = this.project(user, projectId);
    if (!this.get('SELECT id FROM clients WHERE id=?', project.clientId))
      fail('Assign a client before starting work.');
    const template = WORKFLOWS[input.workflowId];
    if (!template) fail('Choose a valid workflow.');
    if (project.status === 'Active') {
      if (project.workflowId !== input.workflowId)
        fail('This project already has a workflow.', 409);
      return { id: projectId }; // activation retries are safe
    }
    const owner = this.owner(projectId, input.ownerId || user.id);
    this.transaction(() => {
      for (const step of template) {
        const record = templateRecord(step);
        this.insertTask(projectId, record.TaskName, 'Task', owner.id, record.Stage);
      }
      this.run(
        "UPDATE projects SET workflowId=?,status='Active' WHERE id=?",
        input.workflowId,
        projectId,
      );
      this.audit(user.id, projectId, 'Internal workflow activated', input.workflowId);
    });
    return { id: projectId };
  }
  insertTask(projectId, title, kind, ownerId, stage = '') {
    const taskId = id();
    this.run(
      'INSERT INTO tasks(id,projectId,title,kind,stage,ownerId,nextAction,createdAt) VALUES (?,?,?,?,?,?,?,?)',
      taskId,
      projectId,
      title,
      kind,
      stage,
      ownerId,
      kind === 'Query'
        ? 'Review the question and record a decision.'
        : 'Review the brief and agree on the next step.',
      now(),
    );
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
      this.notify(
        owner.id,
        projectId,
        taskId,
        'Assignment',
        `You were assigned: ${title}`,
        user.id,
      );
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
    if (
      !Array.isArray(items) ||
      items.length > 50 ||
      items.some(
        (item) =>
          !item ||
          typeof item !== 'object' ||
          typeof item.type !== 'string' ||
          ['type', 'fileId', 'fileName', 'mimeType', 'url'].some(
            (key) =>
              item[key] !== undefined && (typeof item[key] !== 'string' || item[key].length > 2048),
          ),
      )
    )
      fail('Invalid attachments.');
    const attachments = JSON.stringify(items);
    if (attachments.length > 20000) fail('Invalid attachments.');
    this.transaction(() => {
      this.run(
        'INSERT INTO requests(id,projectId,type,body,context,sender,source,sourceMessageId,sourceMetadata,attachments,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        requestId,
        projectId,
        input.type,
        body,
        context,
        sender,
        input.source,
        String(input.sourceMessageId || ''),
        JSON.stringify(input.sourceMetadata || {}),
        attachments,
        now(),
      );
      const founders = this.all("SELECT id FROM users WHERE active=1 AND role='Founder'");
      for (const founder of founders)
        this.notify(
          founder.id,
          projectId,
          null,
          'Client request',
          `${sender}: ${body.slice(0, 160)}`,
          '',
          requestId,
        );
      this.audit(
        input.source === 'Telegram' ? 'Telegram integration' : input.actorId,
        projectId,
        'Client request received',
        requestId,
      );
    });
    return this.get('SELECT * FROM requests WHERE id=?', requestId);
  }
  manualRequest(user, projectId, input) {
    this.founder(user);
    this.project(user, projectId);
    return this.intake(projectId, {
      ...input,
      id: id(),
      source: 'Manual',
      actorId: user.id,
      attachments: input.attachmentUrl ? [{ type: 'Link', url: url(input.attachmentUrl) }] : [],
    });
  }
  telegramRequest(input) {
    const project = this.get(
      'SELECT * FROM projects WHERE telegramProjectId=? AND groupChatId=?',
      String(input.TelegramProjectID || ''),
      String(input.GroupChatID || ''),
    );
    if (!project) fail('Link this bot project and group to a workspace project first.', 404);
    let attachments;
    try {
      attachments = JSON.parse(input.AttachmentsJSON || '[]');
    } catch {
      fail('Invalid attachment metadata.');
    }
    const request = this.intake(project.id, {
      id: input.RequestID,
      type: input.RequestType,
      body: input.OriginalMessage || input.RequestContext || 'Client attachment for review',
      context: input.RequestContext,
      sender: input.OriginalSenderName || input.RequestedByName || 'Client',
      source: 'Telegram',
      sourceMessageId: input.SourceMessageID,
      attachments,
      sourceMetadata: {
        originalSenderTelegramId: String(input.OriginalSenderTelegramID || ''),
        requestedByTelegramId: String(input.RequestedByTelegramID || ''),
        requestedByName: String(input.RequestedByName || ''),
        requestedByRole: String(input.RequestedByRole || ''),
        commandMessageId: String(input.CommandMessageID || ''),
        sourceCreatedAt: String(input.CreatedAt || ''),
      },
    });
    return { request: { id: request.id, status: request.status } };
  }
  reviewRequest(user, requestId, input) {
    this.founder(user);
    const request = this.get('SELECT * FROM requests WHERE id=?', requestId);
    if (!request) fail('Request not found.', 404);
    const project = this.project(user, request.projectId);
    if (!['Approved', 'Rejected', 'Clarification'].includes(input.status))
      fail('Invalid review decision.');
    if (['Approved', 'Resolved', 'Rejected'].includes(request.status)) {
      if (
        request.status === input.status ||
        (request.status === 'Resolved' && input.status === 'Approved')
      )
        return { taskId: request.taskId };
      fail('This request has already been reviewed.', 409);
    }
    const note =
      input.status === 'Approved'
        ? String(input.note || '').slice(0, 2000)
        : text(input.note, 'Review note', 2000);
    if (input.status === 'Approved' && project.status !== 'Active')
      fail('Activate this project before assigning client work.');
    const owner = input.status === 'Approved' ? this.owner(project.id, input.ownerId) : null;
    let taskId = null;
    return this.transaction(() => {
      if (owner) {
        if (input.taskId) {
          const task = this.task(user, input.taskId);
          if (task.projectId !== project.id || task.status === 'Resolved')
            fail('Choose an open task in this project.');
          taskId = task.id;
          this.run('UPDATE tasks SET ownerId=? WHERE id=?', owner.id, taskId);
        } else {
          taskId = this.insertTask(
            project.id,
            text(input.title, 'Task/query title'),
            request.type === 'Question' ? 'Query' : 'Task',
            owner.id,
          );
        }
        this.notify(
          owner.id,
          project.id,
          taskId,
          'Assignment',
          `Client request assigned: ${request.body.slice(0, 120)}`,
          user.id,
        );
      }
      this.run(
        'UPDATE requests SET status=?,taskId=?,reviewNote=?,reviewedAt=? WHERE id=?',
        input.status,
        taskId,
        note,
        now(),
        requestId,
      );
      this.run(
        'UPDATE notifications SET readAt=? WHERE requestId=? AND userId=?',
        now(),
        requestId,
        user.id,
      );
      this.audit(user.id, project.id, `Request ${input.status.toLowerCase()}`, requestId);
      return { taskId };
    });
  }
  notify(userId, projectId, taskId, kind, body, actorId = '', requestId = null, messageSeq = null) {
    if (userId === actorId) return;
    this.run(
      'INSERT INTO notifications(id,userId,projectId,taskId,kind,body,createdAt,requestId,messageSeq) VALUES (?,?,?,?,?,?,?,?,?)',
      id(),
      userId,
      projectId,
      taskId,
      kind,
      body,
      now(),
      requestId,
      messageSeq,
    );
  }
  thread(user, taskId) {
    const task = this.task(user, taskId);
    return {
      task,
      messages: this.all(
        'SELECT m.*,u.name AS authorName,u.role AS authorRole FROM messages m JOIN users u ON u.id=m.authorId WHERE taskId=? ORDER BY seq',
        taskId,
      ),
      requests: this.all(
        "SELECT id,type,body,context,sender,source,attachments,status FROM requests WHERE taskId=? AND status IN ('Approved','Resolved')",
        taskId,
      ).map((r) => ({ ...r, attachments: JSON.parse(r.attachments) })),
    };
  }
  postMessage(user, taskId, input) {
    const task = this.task(user, taskId);
    if (task.status === 'Resolved')
      fail('This thread is resolved. Reopen it before replying.', 409);
    const body = text(input.body, 'Message', 10000);
    const attachmentUrl = url(input.attachmentUrl);
    return this.transaction(() => {
      const result = this.run(
        'INSERT INTO messages(taskId,authorId,body,attachmentUrl,createdAt) VALUES (?,?,?,?,?)',
        taskId,
        user.id,
        body,
        attachmentUrl,
        now(),
      );
      const recipients = this.all(
        "SELECT u.id FROM users u WHERE u.active=1 AND (u.role='Founder' OR EXISTS(SELECT 1 FROM memberships p WHERE p.projectId=? AND p.userId=u.id))",
        task.projectId,
      );
      for (const recipient of recipients)
        this.notify(
          recipient.id,
          task.projectId,
          taskId,
          'Message',
          `${user.name}: ${body.slice(0, 160)}`,
          user.id,
          null,
          Number(result.lastInsertRowid),
        );
      this.audit(
        user.id,
        task.projectId,
        'Internal message posted',
        `${taskId}:${result.lastInsertRowid}`,
      );
      return { seq: Number(result.lastInsertRowid) };
    });
  }
  readThread(user, taskId, lastSeq) {
    this.task(user, taskId);
    if (!Number.isSafeInteger(lastSeq) || lastSeq < 0) fail('Invalid read position.');
    const maximum = Number(
      this.get('SELECT COALESCE(MAX(seq),0) AS seq FROM messages WHERE taskId=?', taskId).seq,
    );
    if (
      lastSeq > maximum ||
      (lastSeq !== 0 &&
        !this.get('SELECT seq FROM messages WHERE taskId=? AND seq=?', taskId, lastSeq))
    )
      fail('Read position must belong to this thread.');
    this.run(
      'INSERT INTO reads VALUES (?,?,?) ON CONFLICT(taskId,userId) DO UPDATE SET lastSeq=MAX(reads.lastSeq,excluded.lastSeq)',
      taskId,
      user.id,
      lastSeq,
    );
    this.run(
      'UPDATE notifications SET readAt=? WHERE userId=? AND taskId=? AND messageSeq<=? AND readAt IS NULL',
      now(),
      user.id,
      taskId,
      lastSeq,
    );
  }
  readNotification(user, notificationId) {
    const notification = this.get(
      'SELECT * FROM notifications WHERE id=? AND userId=?',
      notificationId,
      user.id,
    );
    if (!notification) fail('Notification not found.', 404);
    this.project(user, notification.projectId);
    this.run('UPDATE notifications SET readAt=? WHERE id=?', now(), notificationId);
  }
  updateTask(user, taskId, input) {
    const task = this.task(user, taskId);
    if (user.role !== 'Founder' && task.ownerId !== user.id)
      fail('Only the task owner or founder can update this work.', 403);
    const status = input.status || task.status;
    if (!['Open', 'In progress', 'Blocked', 'Resolved'].includes(status))
      fail('Choose a valid status.');
    const fields = ['decision', 'blocker', 'nextAction'].map((key) =>
      input[key] === undefined
        ? task[key]
        : typeof input[key] === 'string' && input[key].length <= 2000
          ? input[key].trim()
          : fail('Summary fields must be under 2000 characters.'),
    );
    let ownerId = task.ownerId;
    if (input.ownerId !== undefined) {
      this.founder(user);
      ownerId = this.owner(task.projectId, input.ownerId).id;
    }
    let scheduledStart = task.scheduledStart,
      scheduledEnd = task.scheduledEnd;
    if (input.scheduledStart !== undefined || input.scheduledEnd !== undefined) {
      if (input.scheduledStart === null && input.scheduledEnd === null) {
        scheduledStart = scheduledEnd = null;
      } else {
        const validDate = (value) =>
          typeof value === 'string' &&
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
          Number.isFinite(Date.parse(value)) &&
          new Date(value).toISOString() === value;
        if (!validDate(input.scheduledStart) || !validDate(input.scheduledEnd))
          fail('Provide both schedule dates in ISO format.');
        const duration = Date.parse(input.scheduledEnd) - Date.parse(input.scheduledStart);
        if (duration < 30 * 60 * 1000 || duration > 366 * 86400000)
          fail('Schedule duration must be between 30 minutes and 366 days.');
        scheduledStart = input.scheduledStart;
        scheduledEnd = input.scheduledEnd;
      }
    }
    this.transaction(() => {
      this.run(
        'UPDATE tasks SET status=?,decision=?,blocker=?,nextAction=?,ownerId=?,scheduledStart=?,scheduledEnd=? WHERE id=?',
        status,
        ...fields,
        ownerId,
        scheduledStart,
        scheduledEnd,
        taskId,
      );
      this.run(
        "UPDATE requests SET status=? WHERE taskId=? AND status IN ('Approved','Resolved')",
        status === 'Resolved' ? 'Resolved' : 'Approved',
        taskId,
      );
      if (ownerId && ownerId !== task.ownerId)
        this.notify(
          ownerId,
          task.projectId,
          taskId,
          'Assignment',
          `You were assigned: ${task.title}`,
          user.id,
        );
      this.audit(user.id, task.projectId, 'Task updated', `${taskId}: ${status}`);
    });
  }
  snapshot(user) {
    const projects = this.all(
      "SELECT p.*,c.name AS clientName FROM projects p JOIN clients c ON c.id=p.clientId WHERE ?='Founder' OR EXISTS (SELECT 1 FROM memberships m WHERE m.projectId=p.id AND m.userId=?) ORDER BY p.createdAt DESC",
      user.role,
      user.id,
    );
    const tasks = projects.flatMap((project) =>
      this.all(
        `SELECT t.rowid AS taskOrder,t.*,u.name AS ownerName,
      (SELECT COUNT(*) FROM messages m WHERE m.taskId=t.id AND m.authorId!=? AND m.seq>COALESCE((SELECT lastSeq FROM reads r WHERE r.taskId=t.id AND r.userId=?),0)) AS unread,
      COALESCE((SELECT MAX(createdAt) FROM messages m WHERE m.taskId=t.id),t.createdAt) AS lastActivity
      FROM tasks t LEFT JOIN users u ON u.id=t.ownerId WHERE t.projectId=? ORDER BY lastActivity DESC`,
        user.id,
        user.id,
        project.id,
      ),
    );
    const memberships = projects.flatMap((project) =>
      this.all('SELECT projectId,userId FROM memberships WHERE projectId=?', project.id),
    );
    const users =
      user.role === 'Founder'
        ? this.all('SELECT id,name,role,active FROM users ORDER BY name')
        : this.all(
            "SELECT DISTINCT u.id,u.name,u.role,u.active FROM users u WHERE u.active=1 AND (u.role='Founder' OR EXISTS(SELECT 1 FROM memberships m JOIN memberships mine ON mine.projectId=m.projectId WHERE m.userId=u.id AND mine.userId=?))",
            user.id,
          );
    const notifications = this.all(
      "SELECT n.* FROM notifications n WHERE n.userId=? AND (?='Founder' OR EXISTS(SELECT 1 FROM memberships m WHERE m.projectId=n.projectId AND m.userId=?)) ORDER BY (n.readAt IS NULL) DESC,n.createdAt DESC LIMIT 100",
      user.id,
      user.role,
      user.id,
    );
    const notificationUnread = this.get(
      "SELECT COUNT(*) AS count FROM notifications n WHERE n.userId=? AND n.readAt IS NULL AND (?='Founder' OR EXISTS(SELECT 1 FROM memberships m WHERE m.projectId=n.projectId AND m.userId=?))",
      user.id,
      user.role,
      user.id,
    ).count;
    const requests =
      user.role === 'Founder'
        ? this.all('SELECT * FROM requests ORDER BY createdAt DESC').map((r) => ({
            ...r,
            attachments: JSON.parse(r.attachments),
          }))
        : [];
    return {
      user,
      users: users.map(publicUser),
      projects: projects.map((p) => ({
        ...p,
        unread: tasks.filter((t) => t.projectId === p.id).reduce((sum, t) => sum + t.unread, 0),
      })),
      tasks,
      memberships,
      requests,
      notifications,
      notificationUnread,
      clients: user.role === 'Founder' ? this.all('SELECT * FROM clients ORDER BY name') : [],
      workflows: WORKFLOW_OPTIONS.map((w) => ({ ...w, taskCount: WORKFLOWS[w.id].length })),
    };
  }
}
