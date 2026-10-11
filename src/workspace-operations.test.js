import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkspaceStore } from './workspace-store.js';
import { calculateSchedule } from './workspace-schedule.js';
import { deliverReply } from './workspace-delivery.js';
const password = 'isolated-test-password';
function fixture(t) {
  const store = new WorkspaceStore(':memory:'); t.after(() => store.close());
  store.bootstrap('founder', password, 'Studio founders'); const founder = store.login('founder', password).user;
  store.createUser(founder, { id: 'designer', name: 'Designer', role: 'Designer', password }); const designer = store.login('designer', password).user;
  const client = store.createClient(founder, { name: 'Client' });
  const p = store.createProject(founder, { clientId: client.id, name: 'House', telegramProjectId: 'P1', groupChatId: '-123' });
  store.setMember(founder, p.id, designer.id, true); store.activate(founder, p.id, { workflowId: 'PAINTING-V1', startDate: '2026-10-11' });
  const task = store.createTask(founder, p.id, { title: 'Carpentry', kind: 'Task', ownerId: designer.id });
  return { store, founder, designer, projectId: p.id, taskId: task.id };
}
function question(store) { return store.telegramRequest({ TelegramProjectID: 'P1', GroupChatID: '-123', RequestID: 'Q1', RequestType: 'Question', SourceMessageID: '12', OriginalSenderName: 'Carpenter', OriginalSenderTelegramID: '99', OriginalMessage: 'Which finish should I use?', AttachmentsJSON: '[]' }); }
const task = (id, durationDays = 2) => ({ id, title: id, durationDays, status: 'Open', delayDays: 0 });
test('scheduling is independent of row order; joins and SS edges respect their own anchors', () => {
  const tasks = [{ ...task('a'), actualStart: '2026-10-11' }, task('b', 8), task('c'), task('d')];
  const edges = [{ taskId: 'c', predecessorId: 'a', type: 'SS' }, { taskId: 'd', predecessorId: 'a', type: 'FS' }, { taskId: 'd', predecessorId: 'b', type: 'FS' }];
  const before = calculateSchedule(tasks, edges, '2026-10-11');
  const after = calculateSchedule([{ ...tasks[0], delayDays: 3 }, ...tasks.slice(1)].reverse(), edges, '2026-10-11');
  assert.equal(after.find(t => t.id === 'c').forecastStart, before.find(t => t.id === 'c').forecastStart);
  assert.equal(after.find(t => t.id === 'd').forecastStart, '2026-10-19');
  const long = calculateSchedule([{ ...tasks[0], delayDays: 9 }, ...tasks.slice(1)], edges, '2026-10-11');
  assert.equal(long.find(t => t.id === 'd').forecastStart, '2026-10-22');
});
test('unknown duration stays unset; cycles and invalid dates are rejected', () => {
  assert.equal(calculateSchedule([task('a', null)], [], '2026-10-11')[0].forecastEnd, '');
  assert.throws(() => calculateSchedule([task('a'), task('b')], [{ taskId: 'a', predecessorId: 'b', type: 'FS' }, { taskId: 'b', predecessorId: 'a', type: 'FS' }], '2026-10-11'), /cycle/);
  assert.throws(() => calculateSchedule([task('a')], [], '2026-02-31'), /valid/);
});
test('a delay preserves actual dates and independent parallel work', () => {
  const tasks = [{ ...task('site'), actualStart: '2026-10-11', delayDays: 3 }, task('design'), task('execute')];
  const result = calculateSchedule(tasks, [{ taskId: 'execute', predecessorId: 'site', type: 'FS' }], '2026-10-11');
  assert.equal(result[0].forecastStart, '2026-10-11'); assert.equal(result[1].forecastStart, '2026-10-11'); assert.equal(result[2].forecastStart, '2026-10-16');
});
test('intervention reading, shared ownership and resolution are independent and version checked', t => {
  const { store, founder, designer } = fixture(t); question(store);
  const i = store.snapshot(founder).interventions[0];
  store.handleIntervention(founder, i.id, { action: 'read', version: i.version });
  assert.equal(store.snapshot(founder).interventions.length, 1); assert.ok(store.snapshot(founder).interventions[0].readAt);
  store.handleIntervention(founder, i.id, { action: 'assign', owner: 'Gosik', version: i.version });
  assert.throws(() => store.handleIntervention(founder, i.id, { action: 'assign', owner: 'Nishank', version: i.version }), /changed/);
  assert.throws(() => store.backtrack(designer, i.id), /founder/);
  assert.equal(store.snapshot(founder).interventions[0].owner, 'Gosik');
});
test('task linkage recovers instructions and rejects cross-project linkage', t => {
  const { store, founder, taskId, projectId } = fixture(t);
  const tsk = store.task(founder, taskId); store.configureWork(founder, taskId, { version: tsk.version, brief: 'Use the approved finish.', externalName: 'Carpenter', externalTelegramId: '99', durationDays: 2 });
  question(store); const i = store.snapshot(founder).interventions[0]; const b = store.backtrack(founder, i.id);
  assert.equal(b.task.id, taskId); assert.equal(b.task.brief, 'Use the approved finish.');
  const client = store.createClient(founder, { name: 'Other' }); const p = store.createProject(founder, { name: 'Other', clientId: client.id }); store.activate(founder, p.id, { workflowId: 'PAINTING-V1' });
  const otherTask = store.snapshot(founder).tasks.find(t => t.projectId !== projectId);
  assert.throws(() => store.handleIntervention(founder, i.id, { action: 'link', taskId: otherTask.id, version: i.version }), /this project/);
});
test('completion requires founder review, inputs, and retains rework evidence', t => {
  const { store, founder, designer, taskId } = fixture(t);
  store.requirement(founder, taskId, { title: 'Verified measurements' });
  const s = store.submitWork(designer, taskId, { evidenceUrl: 'https://example.com/photo.jpg', note: 'Done' });
  assert.equal(store.task(founder, taskId).status, 'Awaiting review');
  assert.throws(() => store.reviewSubmission(designer, s.id, { outcome: 'Approved' }), /founder/);
  assert.throws(() => store.reviewSubmission(founder, s.id, { outcome: 'Approved' }), /inputs/);
  store.reviewSubmission(founder, s.id, { outcome: 'Changes requested', feedback: 'Correct the finish.' });
  assert.equal(store.task(founder, taskId).status, 'Rework required');
  const requirement = store.snapshot(founder).requirements[0]; store.requirement(founder, taskId, { id: requirement.id, verified: true });
  const next = store.submitWork(designer, taskId, { evidenceUrl: 'https://example.com/corrected.jpg' }); store.reviewSubmission(founder, next.id, { outcome: 'Approved' });
  assert.equal(store.task(founder, taskId).status, 'Resolved'); assert.equal(store.snapshot(founder).submissions.length, 2);
  assert.throws(() => store.reviewSubmission(founder, next.id, { outcome: 'Approved' }), /already/);
});
test('repeated source photos create one review submission and preserve media authorization path', t => {
  const { store, founder, taskId } = fixture(t);
  store.configureWork(founder, taskId, { version: 1, externalTelegramId: '99', durationDays: 2 });
  const input = { TelegramProjectID: 'P1', GroupChatID: '-123', RequestID: 'PHOTO1', RequestType: 'Question', OriginalSenderTelegramID: '99', OriginalSenderName: 'Carpenter', OriginalMessage: 'Work completed', AttachmentsJSON: '[{"type":"Photo","fileId":"file"}]' };
  store.telegramRequest(input); store.telegramRequest(input);
  assert.equal(store.snapshot(founder).submissions.length, 1); assert.equal(store.task(founder, taskId).status, 'Awaiting review');
  assert.match(store.snapshot(founder).submissions[0].evidenceUrl, /^\/api\/workspace\/requests\//);
});
test('reply intents deduplicate and uncertain delivery stays actionable', async t => {
  const { store, founder } = fixture(t); question(store); const i = store.snapshot(founder).interventions[0];
  const r = store.queueReply(founder, i.id, { body: 'Use the approved finish.', intentKey: 'same' });
  assert.equal(store.queueReply(founder, i.id, { body: r.body, intentKey: 'same' }).id, r.id);
  let attempts = 0; await deliverReply(store, r.id, 'test-token', async () => { attempts++; throw new Error('timeout'); });
  await deliverReply(store, r.id, 'test-token', async () => { attempts++; }); assert.equal(attempts, 1);
  assert.equal(store.get('SELECT state FROM replies WHERE id=?', r.id).state, 'Unknown');
  assert.throws(() => store.handleIntervention(founder, i.id, { action: 'resolve', note: 'Done', version: 1 }), /delivery/);
  assert.throws(() => store.queueReply(founder, i.id, { body: 'Try again', intentKey: 'new' }), /pending/);
});
test('successful reply delivery remains distinct from task completion', async t => {
  const { store, founder } = fixture(t); question(store); const i = store.snapshot(founder).interventions[0];
  const r = store.queueReply(founder, i.id, { body: 'Use the lighter finish.', intentKey: 'sent' });
  await deliverReply(store, r.id, 'test-token', async () => ({ ok: true, json: async () => ({ ok: true, result: { message_id: 100 } }) }));
  assert.equal(store.get('SELECT state FROM replies WHERE id=?', r.id).state, 'Sent');
  assert.equal(store.snapshot(founder).interventions.length, 1);
});
test('cycle edits rollback the work plan and delay events apply only once at a version', t => {
  const { store, founder, projectId, taskId } = fixture(t);
  const b = store.createTask(founder, projectId, { title: 'Dependent', kind: 'Task', ownerId: founder.id });
  store.configureWork(founder, b.id, { version: 1, predecessorId: taskId, durationDays: 2 });
  assert.throws(() => store.configureWork(founder, taskId, { version: 1, predecessorId: b.id, durationDays: 2 }), /cycle/);
  assert.equal(store.task(founder, taskId).version, 1);
  store.delayWork(founder, taskId, { version: 1, days: 3, reason: 'Rain' });
  assert.throws(() => store.delayWork(founder, taskId, { version: 1, days: 3, reason: 'Rain' }), /changed/);
  assert.equal(store.task(founder, taskId).delayDays, 3);
});

test('a not-started weather delay postpones both start and finish', () => {
  const result = calculateSchedule([{ ...task('site'), delayDays: 3 }, task('execution')], [{ taskId: 'execution', predecessorId: 'site', type: 'FS' }], '2026-10-11');
  assert.equal(result[0].forecastStart, '2026-10-14'); assert.equal(result[0].forecastEnd, '2026-10-15'); assert.equal(result[1].forecastStart, '2026-10-16');
});

test('founder drawing approval opens the dependency gate without client approval', t => {
  const { store, founder, designer, taskId } = fixture(t);
  store.run("UPDATE tasks SET gateType='approval' WHERE id=?", taskId);
  const r = store.addResource(designer, taskId, { title: 'Carpentry drawing V1', url: 'https://example.com/drawing.pdf' });
  assert.throws(() => store.approveResource(designer, r.id), /founder/);
  store.approveResource(founder, r.id);
  assert.equal(store.task(founder, taskId).status, 'Resolved');
  assert.equal(store.snapshot(founder).resources[0].state, 'Approved');
});
