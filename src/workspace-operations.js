import { randomUUID } from 'node:crypto';
import { calculateSchedule, validDate } from './workspace-schedule.js';

const now = () => new Date().toISOString();
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const uid = () => randomUUID();
function check(condition, message, status = 400) { if (!condition) { const error = new Error(message); error.status = status; throw error; } }
function content(value, label, max = 2000) { check(typeof value === 'string' && value.trim() && value.length <= max, `${label} is required (up to ${max} characters).`); return value.trim(); }
function https(value) { try { const u = new URL(value); check(u.protocol === 'https:' && !u.username && !u.password && value.length <= 2048, 'Use an HTTPS reference.'); return u.href; } catch { check(false, 'Use an HTTPS reference.'); } }

export function initializeOperations(store) {
  const add = (table, name, type) => { if (!store.all(`PRAGMA table_info(${table})`).some(c => c.name === name)) store.db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`); };
  for (const [name, type] of Object.entries({ startDate: "TEXT NOT NULL DEFAULT ''", scheduleVersion: 'INTEGER NOT NULL DEFAULT 0' })) add('projects', name, type);
  for (const [name, type] of Object.entries({ gateType: "TEXT NOT NULL DEFAULT ''", brief: "TEXT NOT NULL DEFAULT ''", externalName: "TEXT NOT NULL DEFAULT ''", externalTelegramId: "TEXT NOT NULL DEFAULT ''", durationDays: 'INTEGER', delayDays: 'INTEGER NOT NULL DEFAULT 0', baselineStart: "TEXT NOT NULL DEFAULT ''", baselineEnd: "TEXT NOT NULL DEFAULT ''", forecastStart: "TEXT NOT NULL DEFAULT ''", forecastEnd: "TEXT NOT NULL DEFAULT ''", actualStart: "TEXT NOT NULL DEFAULT ''", actualEnd: "TEXT NOT NULL DEFAULT ''", notBefore: "TEXT NOT NULL DEFAULT ''", unscheduledReason: "TEXT NOT NULL DEFAULT ''", dependencyBlocker: "TEXT NOT NULL DEFAULT ''", version: 'INTEGER NOT NULL DEFAULT 1' })) add('tasks', name, type);
  store.db.exec(`
    CREATE TABLE IF NOT EXISTS interventions (id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id), taskId TEXT REFERENCES tasks(id), requestId TEXT UNIQUE REFERENCES requests(id), kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, sender TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Open', owner TEXT NOT NULL DEFAULT '', readAt TEXT, version INTEGER NOT NULL DEFAULT 1, createdAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS dependencies (taskId TEXT NOT NULL REFERENCES tasks(id), predecessorId TEXT NOT NULL REFERENCES tasks(id), type TEXT NOT NULL, PRIMARY KEY(taskId,predecessorId));
    CREATE TABLE IF NOT EXISTS resources (id TEXT PRIMARY KEY, taskId TEXT NOT NULL REFERENCES tasks(id), title TEXT NOT NULL, url TEXT NOT NULL, purpose TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'Draft', createdAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS requirements (id TEXT PRIMARY KEY, taskId TEXT NOT NULL REFERENCES tasks(id), title TEXT NOT NULL, verified INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS submissions (id TEXT PRIMARY KEY, taskId TEXT NOT NULL REFERENCES tasks(id), evidenceUrl TEXT NOT NULL, note TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Pending', feedback TEXT NOT NULL DEFAULT '', createdAt TEXT NOT NULL, decidedAt TEXT);
    CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, projectId TEXT NOT NULL REFERENCES projects(id), taskId TEXT, kind TEXT NOT NULL, body TEXT NOT NULL, actor TEXT NOT NULL, createdAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS replies (id TEXT PRIMARY KEY, interventionId TEXT NOT NULL REFERENCES interventions(id), body TEXT NOT NULL, intentKey TEXT NOT NULL UNIQUE, state TEXT NOT NULL DEFAULT 'Queued', error TEXT NOT NULL DEFAULT '', telegramMessageId TEXT NOT NULL DEFAULT '', createdAt TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS intervention_state ON interventions(status,createdAt);
    CREATE INDEX IF NOT EXISTS event_project ON events(projectId,seq);
  `);
  // Backfill only genuinely pending requests; old task history remains untouched.
  for (const r of store.all("SELECT * FROM requests WHERE status IN ('Pending','Clarification','Approved')")) store.run('INSERT OR IGNORE INTO interventions(id,projectId,taskId,requestId,kind,title,body,sender,createdAt) VALUES (?,?,?,?,?,?,?,?,?)', uid(), r.projectId, r.taskId, r.id, r.type, r.type === 'Approval' ? 'Decision needed' : 'A question needs you', r.body, r.sender, r.createdAt);
  store.run("UPDATE replies SET state='Unknown',error='Service restarted during delivery. Check Telegram before sending again.' WHERE state='Sending'");
}

export const operations = {
  event(user, projectId, taskId, kind, body) { this.run('INSERT INTO events(projectId,taskId,kind,body,actor,createdAt) VALUES (?,?,?,?,?,?)', projectId, taskId || null, kind, body, user.name || user.id || 'Telegram', now()); },
  openIntervention(projectId, taskId, kind, body, sender, requestId = null) {
    const interventionId = uid();
    this.run('INSERT OR IGNORE INTO interventions(id,projectId,taskId,requestId,kind,title,body,sender,createdAt) VALUES (?,?,?,?,?,?,?,?,?)', interventionId, projectId, taskId || null, requestId, kind, kind === 'Review' ? 'Work ready for your review' : 'A question needs you', body, sender, now());
    return interventionId;
  },
  intervention(user, interventionId) {
    this.founder(user); const item = this.get('SELECT * FROM interventions WHERE id=?', interventionId);
    check(item, 'Intervention not found.', 404); this.project(user, item.projectId); return item;
  },
  handleIntervention(user, interventionId, input) {
    const item = this.intervention(user, interventionId);
    check(input.version === item.version, 'This item changed. Refresh before acting.', 409);
    if (input.action === 'read') { this.run('UPDATE interventions SET readAt=? WHERE id=?', now(), item.id); return; }
    check(['assign', 'resolve', 'link'].includes(input.action), 'Choose a valid action.');
    if (input.action === 'assign') check(['Gosik', 'Nishank'].includes(input.owner), 'Choose Gosik or Nishank.');
    if (input.action === 'resolve') { check(item.kind !== 'Review', 'Approve or request changes from the work review.'); check(!this.get("SELECT 1 FROM replies WHERE interventionId=? AND state IN ('Queued','Sending','Unknown')", item.id), 'Check pending reply delivery before marking handled.'); content(input.note, 'Resolution note'); }
    if (input.action === 'link') check(this.task(user, input.taskId).projectId === item.projectId, 'Choose work in this project.');
    this.transaction(() => {
      this.run('UPDATE interventions SET owner=?,status=?,taskId=?,version=version+1 WHERE id=?', input.action === 'assign' ? input.owner : item.owner, input.action === 'resolve' ? 'Resolved' : item.status, input.action === 'link' ? input.taskId : item.taskId, item.id);
      if (input.action === 'link' && item.requestId) this.run('UPDATE requests SET taskId=? WHERE id=?', input.taskId, item.requestId);
      this.event(user, item.projectId, item.taskId, 'Intervention', input.action === 'assign' ? `${input.owner} is handling: ${item.body}` : input.action === 'resolve' ? input.note : 'Question linked to work.');
    });
  },
  backtrack(user, interventionId) {
    const item = this.intervention(user, interventionId);
    const task = item.taskId ? this.task(user, item.taskId) : null;
    const request = item.requestId ? this.get('SELECT * FROM requests WHERE id=?', item.requestId) : null;
    const external = task ? this.all('SELECT id,sender AS authorName,body,createdAt FROM requests WHERE taskId=? ORDER BY createdAt DESC LIMIT 12', task.id).map(m => ({ ...m, visibility: 'External message' })) : [];
    const sent = task ? this.all("SELECT r.id,'Founder' AS authorName,r.body,r.createdAt FROM replies r JOIN interventions i ON i.id=r.interventionId WHERE i.taskId=? AND r.state='Sent' ORDER BY r.createdAt DESC LIMIT 12", task.id).map(m => ({ ...m, visibility: 'Sent to Telegram' })) : [];
    const internal = task ? this.thread(user, task.id).messages.slice(-12).map(m => ({ ...m, id: `message-${m.seq}`, visibility: 'Internal team' })) : [];
    return { item, task, request: request ? { ...request, attachments: JSON.parse(request.attachments) } : null,
      conversation: [...external, ...sent, ...internal].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-12),
      messages: task ? this.thread(user, task.id).messages.slice(-12) : [],
      resources: task ? this.all('SELECT * FROM resources WHERE taskId=? ORDER BY createdAt DESC', task.id) : [],
      history: this.all("SELECT * FROM events WHERE projectId=? AND (taskId=? OR (taskId IS NULL AND kind='Project started')) ORDER BY seq DESC LIMIT 30", item.projectId, item.taskId),
      replies: this.all('SELECT * FROM replies WHERE interventionId=? ORDER BY createdAt', item.id) };
  },
  recalculate(projectId) {
    const project = this.get('SELECT * FROM projects WHERE id=?', projectId);
    const tasks = this.all('SELECT * FROM tasks WHERE projectId=?', projectId);
    const edges = this.all('SELECT d.* FROM dependencies d JOIN tasks t ON t.id=d.taskId WHERE t.projectId=?', projectId);
    let dates; try { dates = calculateSchedule(tasks, edges, project.startDate || today()); } catch (error) { check(false, error.message); }
    for (const d of dates) this.run('UPDATE tasks SET forecastStart=?,forecastEnd=?,unscheduledReason=?,dependencyBlocker=? WHERE id=?', d.forecastStart, d.forecastEnd, d.unscheduledReason, d.dependencyBlocker, d.id);
    this.run('UPDATE projects SET scheduleVersion=scheduleVersion+1 WHERE id=?', projectId);
    return dates;
  },
  configureWork(user, taskId, input) {
    this.founder(user); const task = this.task(user, taskId);
    check(input.version === task.version, 'This work changed. Refresh before editing.', 409);
    const duration = input.durationDays === '' || input.durationDays == null ? null : Number(input.durationDays);
    check(duration === null || Number.isInteger(duration) && duration > 0 && duration <= 3650, 'Duration must be a positive whole number of days.');
    const start = input.notBefore || ''; check(!start || validDate(start), 'Use a valid start date.');
    const externalId = input.externalTelegramId || ''; check(!externalId || /^\d{1,30}$/.test(externalId), 'Telegram user ID must be numeric.');
    const brief = input.brief || ''; check(typeof brief === 'string' && brief.length <= 10000, 'Instructions must be under 10,000 characters.');
    const predecessor = input.predecessorId || ''; if (predecessor) check(predecessor !== taskId && this.task(user, predecessor).projectId === task.projectId, 'Choose another task in this project.');
    const additional = input.addPredecessor || ''; if (additional) check(additional !== taskId && this.task(user, additional).projectId === task.projectId, 'Choose another task in this project.');
    this.transaction(() => {
      this.run('UPDATE tasks SET brief=?,externalName=?,externalTelegramId=?,durationDays=?,notBefore=?,version=version+1 WHERE id=?', brief, String(input.externalName || '').slice(0, 200), externalId, duration, start, taskId);
      // Dependencies are changed only when the form explicitly supplies the field.
      if (input.predecessorId !== undefined) { this.run('DELETE FROM dependencies WHERE taskId=?', taskId); if (predecessor) this.run('INSERT INTO dependencies VALUES (?,?,?)', taskId, predecessor, input.dependencyType === 'SS' ? 'SS' : 'FS'); }
      if (additional) this.run('INSERT OR IGNORE INTO dependencies VALUES (?,?,?)', taskId, additional, 'FS');
      this.recalculate(task.projectId);
      this.run("UPDATE tasks SET baselineStart=forecastStart,baselineEnd=forecastEnd WHERE id=? AND baselineStart=''", taskId);
      this.event(user, task.projectId, taskId, 'Assignment', `${task.title}: ${brief || 'Work plan updated'}${input.externalName ? ` · ${input.externalName}` : ''}`);
    });
  },
  delayWork(user, taskId, input) {
    const task = this.task(user, taskId); check(user.role === 'Founder' || task.ownerId === user.id, 'Only the owner can report a delay.', 403);
    check(input.version === task.version, 'This work changed. Refresh before reporting a delay.', 409);
    check(task.status !== 'Resolved', 'Completed work cannot be delayed.');
    const days = Number(input.days); check(Number.isInteger(days) && days > 0 && days <= 365, 'Use 1–365 whole days.'); const reason = content(input.reason, 'Delay reason');
    this.transaction(() => { this.run('UPDATE tasks SET delayDays=delayDays+?,blocker=?,version=version+1 WHERE id=?', days, reason, taskId); this.recalculate(task.projectId); this.event(user, task.projectId, taskId, 'Delay', `${task.title}: ${days} calendar days added. ${reason}`); });
  },
  addResource(user, taskId, input) {
    const task = this.task(user, taskId); check(user.role === 'Founder' || task.ownerId === user.id, 'Only the owner can add a reference.', 403);
    const title = content(input.title, 'Reference name', 200); const reference = https(input.url); const resourceId = uid();
    this.transaction(() => { this.run('INSERT INTO resources(id,taskId,title,url,purpose,createdAt) VALUES (?,?,?,?,?,?)', resourceId, taskId, title, reference, input.purpose === 'Input' ? 'Input' : 'Drawing', now()); this.event(user, task.projectId, taskId, 'Reference', `${title} added for review.`); }); return { id: resourceId };
  },
  approveResource(user, resourceId) {
    this.founder(user); const r = this.get('SELECT * FROM resources WHERE id=?', resourceId); check(r, 'Reference not found.', 404); const task = this.task(user, r.taskId);
    if (task.gateType === 'approval') { check(!task.dependencyBlocker, task.dependencyBlocker); check(!this.get('SELECT 1 FROM requirements WHERE taskId=? AND verified=0', task.id), 'Verify required inputs first.'); }
    this.transaction(() => {
      this.run("UPDATE resources SET state='Superseded' WHERE taskId=? AND title=? AND purpose=? AND state='Approved' AND id!=?", r.taskId, r.title, r.purpose, r.id);
      this.run("UPDATE resources SET state='Approved' WHERE id=?", resourceId);
      if (task.gateType === 'approval' && r.purpose === 'Drawing') { this.run("UPDATE tasks SET status='Resolved',actualEnd=?,version=version+1 WHERE id=?", today(), task.id); this.recalculate(task.projectId); }
      this.event(user, task.projectId, task.id, 'Approval', `${r.title} approved by founder.`);
    });
  },
  requirement(user, taskId, input) {
    this.founder(user); this.task(user, taskId);
    if (input.id) { check(this.get('SELECT 1 FROM requirements WHERE id=? AND taskId=?', input.id, taskId), 'Input not found.', 404); check(typeof input.verified === 'boolean', 'Choose a verification state.'); this.run('UPDATE requirements SET verified=? WHERE id=?', input.verified ? 1 : 0, input.id); }
    else this.run('INSERT INTO requirements(id,taskId,title) VALUES (?,?,?)', uid(), taskId, content(input.title, 'Required input', 200));
  },
  submitWork(user, taskId, input) {
    const task = this.task(user, taskId); check(user.role === 'Founder' || task.ownerId === user.id, 'Only the owner can submit work.', 403);
    check(!['Awaiting review', 'Resolved'].includes(task.status), 'Work is already submitted or completed.', 409);
    const evidence = https(input.evidenceUrl); const submissionId = uid();
    this.transaction(() => { this.run('INSERT INTO submissions(id,taskId,evidenceUrl,note,createdAt) VALUES (?,?,?,?,?)', submissionId, taskId, evidence, String(input.note || '').slice(0, 2000), now()); this.run("UPDATE tasks SET status='Awaiting review',version=version+1 WHERE id=?", taskId); this.openIntervention(task.projectId, taskId, 'Review', `${task.title} has a completion photo ready to check.`, user.name); this.event(user, task.projectId, taskId, 'Submission', `${task.title} submitted for founder review.`); }); return { id: submissionId };
  },
  reviewSubmission(user, submissionId, input) {
    this.founder(user); const s = this.get('SELECT * FROM submissions WHERE id=?', submissionId); check(s, 'Submission not found.', 404); const task = this.task(user, s.taskId);
    check(s.status === 'Pending' && task.status === 'Awaiting review', 'This submission was already reviewed.', 409);
    check(['Approved', 'Changes requested'].includes(input.outcome), 'Choose approve or request changes.');
    const feedback = input.outcome === 'Changes requested' ? content(input.feedback, 'Correction instructions') : String(input.feedback || '').slice(0, 2000);
    if (input.outcome === 'Approved') { check(!task.dependencyBlocker, task.dependencyBlocker); check(!this.get('SELECT 1 FROM requirements WHERE taskId=? AND verified=0', task.id), 'Verify required inputs first.'); }
    this.transaction(() => {
      this.run('UPDATE submissions SET status=?,feedback=?,decidedAt=? WHERE id=?', input.outcome, feedback, now(), s.id);
      this.run('UPDATE tasks SET status=?,actualEnd=?,nextAction=?,version=version+1 WHERE id=?', input.outcome === 'Approved' ? 'Resolved' : 'Rework required', input.outcome === 'Approved' ? today() : '', feedback || 'Founder approved the completed work.', task.id);
      this.run("UPDATE interventions SET status='Resolved',version=version+1 WHERE taskId=? AND kind='Review' AND status='Open'", task.id);
      this.recalculate(task.projectId); this.event(user, task.projectId, task.id, 'Review', `${task.title}: ${input.outcome}. ${feedback}`);
    });
  },
  queueReply(user, interventionId, input) {
    const i = this.intervention(user, interventionId); const body = content(input.body, 'Reply', 4000); const key = content(input.intentKey, 'Reply key', 100);
    const existing = this.get('SELECT * FROM replies WHERE intentKey=?', key); if (existing) { check(existing.interventionId === i.id && existing.body === body, 'Reply key already used.', 409); return existing; }
    const project = this.project(user, i.projectId); check(project.groupChatId && i.requestId && this.get('SELECT source FROM requests WHERE id=?', i.requestId)?.source === 'Telegram', 'This item is not connected to a Telegram message.');
    check(!this.get("SELECT 1 FROM replies WHERE interventionId=? AND state IN ('Queued','Sending','Unknown')", i.id), 'A reply is pending or needs delivery checking.', 409);
    const replyId = uid(); this.run('INSERT INTO replies(id,interventionId,body,intentKey,createdAt) VALUES (?,?,?,?,?)', replyId, i.id, body, key, now()); return this.get('SELECT * FROM replies WHERE id=?', replyId);
  },
  reconcileReply(user, replyId, input) {
    this.founder(user); const r = this.get('SELECT * FROM replies WHERE id=?', replyId); check(r, 'Reply not found.', 404); this.intervention(user, r.interventionId); check(r.state === 'Unknown' || r.state === 'Failed', 'Only uncertain or failed delivery can be checked.');
    check(['Sent', 'Failed'].includes(input.state), 'Confirm whether the reply was delivered.'); content(input.note, 'Check note'); this.run('UPDATE replies SET state=?,error=? WHERE id=?', input.state, input.note, replyId);
  },
  enrichSnapshot(user, snapshot) {
    const ids = new Set(snapshot.projects.map(p => p.id));
    snapshot.interventions = user.role === 'Founder' ? this.all("SELECT * FROM interventions WHERE status='Open' ORDER BY createdAt").filter(i => ids.has(i.projectId)) : [];
    snapshot.events = this.all('SELECT * FROM events ORDER BY seq DESC LIMIT 100').filter(e => ids.has(e.projectId));
    snapshot.dependencies = this.all('SELECT * FROM dependencies').filter(e => snapshot.tasks.some(t => t.id === e.taskId));
    snapshot.resources = this.all('SELECT * FROM resources').filter(r => snapshot.tasks.some(t => t.id === r.taskId));
    snapshot.requirements = this.all('SELECT * FROM requirements').filter(r => snapshot.tasks.some(t => t.id === r.taskId));
    snapshot.submissions = this.all('SELECT * FROM submissions ORDER BY createdAt DESC').filter(s => snapshot.tasks.some(t => t.id === s.taskId));
    return snapshot;
  },
};
