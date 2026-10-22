import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { startWebBridge } from './web-bridge.js';

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

const six = (days = [1, 2, 1, 1, 5, 2]) => ['site-check', 'drawing', 'approval', 'client', 'execution', 'final-check'].map((key, index) => ({ key, durationDays: days[index] }));

async function bridge() {
  process.env.INTEGRATION_SHARED_SECRET = 'test-secret';
  process.env.BOT_BRIDGE_PORT = String(await freePort());
  const project = { ProjectID: 'P009', ProjectName: 'Sameep Residence', GroupChatID: '-900', Status: 'Setup', StartDate: '', TargetEndDate: '', rowNumber: 2 };
  const members = [
    { GroupChatID: '-900', TelegramUserID: '50', MembershipStatus: 'Active', AssignedName: 'Asha', AssignedRole: 'Client' },
    { GroupChatID: '-900', TelegramUserID: '51', MembershipStatus: 'Active', AssignedName: 'Riya', AssignedRole: 'Designer' },
  ];
  const tasks = [];
  const audits = [];
  const sent = [];
  const store = {
    projectForGroup: async (id) => (id === '-900' ? project : undefined),
    rows: async (sheet) => ({ Tasks: tasks, GroupMembers: members, WorkflowTemplates: [] }[sheet] || []),
    tasksForProject: async () => tasks.map((task) => ({ ...task })),
    appendRows: async (sheet, rows) => { for (const row of rows) tasks.push({ ...row, rowNumber: tasks.length + 2 }); },
    updateRows: async (sheet, list) => { for (const { rowNumber, changes } of list) Object.assign(tasks.find((row) => row.rowNumber === rowNumber), changes); },
    updateRow: async (sheet, rowNumber, changes) => Object.assign(sheet === 'Projects' ? project : tasks.find((row) => row.rowNumber === rowNumber), changes),
    audit: async (entry) => audits.push(entry),
  };
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url).includes('api.telegram.org')) { sent.push(JSON.parse(options.body)); return Response.json({ ok: true, result: { message_id: 1 } }); }
    return priorFetch(url, options);
  };
  const server = startWebBridge({ store, token: 'bot-token', founderTelegramId: '7' });
  await new Promise((resolve) => server.once('listening', resolve));
  const post = async (route, payload) => {
    const response = await priorFetch(`http://127.0.0.1:${process.env.BOT_BRIDGE_PORT}${route}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer test-secret' }, body: JSON.stringify(payload) });
    return { status: response.status, body: await response.json() };
  };
  const close = async () => { globalThis.fetch = priorFetch; await new Promise((resolve) => server.close(resolve)); };
  return { project, tasks, audits, sent, post, close };
}

test('a blank project starts with no tasks, is listed first, and is announced once', async () => {
  const { project, tasks, sent, post, close } = await bridge();
  try {
    const workflows = await post('/api/integrations/web/workflows', { groupChatId: '-900' });
    assert.equal(workflows.body.workflows[0].id, 'BLANK-V1');
    const started = await post('/api/integrations/web/projects/start', { groupChatId: '-900', workflowId: 'BLANK-V1', startDate: '2026-10-20' });
    assert.equal(started.status, 200);
    assert.deepEqual(started.body.tasks, []);
    assert.equal(tasks.length, 0);
    assert.deepEqual([project.Status, project.StartDate, project.ClientTelegramID, project.WebManaged], ['Active', '2026-10-20', '50', 'Yes']);
    const again = await post('/api/integrations/web/projects/start', { groupChatId: '-900', workflowId: 'BLANK-V1', startDate: '2026-10-20' });
    assert.equal(again.status, 200);
    assert.equal(sent.length, 1, 'announced once');
  } finally { await close(); }
});

test('stages are previewed, added in one write, and protected from duplicates', async () => {
  const { project, tasks, audits, post, close } = await bridge();
  try {
    const stage = { name: 'Civil', placement: { type: 'date', startDate: '2026-11-02' }, tasks: six() };
    const preview = await post('/api/integrations/web/stages/add', { groupChatId: '-900', mode: 'preview', stage });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.created.length, 6);
    assert.equal(preview.body.created[1].assigneeName, 'Riya');
    assert.equal(preview.body.finish, '2026-11-13');
    assert.equal(tasks.length, 0, 'preview writes nothing');
    const applied = await post('/api/integrations/web/stages/add', { groupChatId: '-900', mode: 'apply', stage, actorName: 'Founder' });
    assert.equal(applied.status, 200);
    assert.equal(tasks.length, 6);
    assert.equal(project.TargetEndDate, '2026-11-13');
    assert.equal(audits.at(-1).action, 'Stage added');
    const duplicate = await post('/api/integrations/web/stages/add', { groupChatId: '-900', mode: 'apply', stage: { ...stage, name: 'CIVIL' } });
    assert.equal(duplicate.status, 409);
    assert.match(duplicate.body.error, /already exists/);
    const bad = await post('/api/integrations/web/stages/add', { groupChatId: '-900', mode: 'apply', stage: { name: 'X', tasks: [{ key: 'nope', durationDays: 1 }] } });
    assert.equal(bad.status, 400);
    const many = await post('/api/integrations/web/stages/add', { groupChatId: '-900', mode: 'apply', stages: [{ name: 'Flooring', tasks: six() }, { name: 'Electrical', placement: { type: 'parallel', stageName: 'Flooring' }, tasks: six() }] });
    assert.equal(many.status, 200);
    assert.equal(tasks.length, 18);
    assert.equal(tasks.find((task) => task.TaskName === 'Electrical — Site Condition Check').ForecastStart, '2026-11-14');
  } finally { await close(); }
});

test('delay, stale retries and completion go through the engine', async () => {
  const { tasks, audits, post, close } = await bridge();
  try {
    await post('/api/integrations/web/stages/add', { groupChatId: '-900', mode: 'apply', stage: { name: 'Civil', placement: { type: 'date', startDate: '2026-11-02' }, tasks: six() } });
    await post('/api/integrations/web/stages/add', { groupChatId: '-900', mode: 'apply', stage: { name: 'Flooring', tasks: six() } });
    const body = { groupChatId: '-900', taskId: 'P009-ST1-2', action: 'delay', days: 3, fromStart: '2026-11-03', fromEnd: '2026-11-04' };
    const preview = await post('/api/integrations/web/tasks/action', { ...body, mode: 'preview' });
    assert.equal(preview.status, 200);
    assert.match(preview.body.summary, /^Delayed "Drawing" by 3 days\. 10 later tasks moved\. Projected finish /);
    const applied = await post('/api/integrations/web/tasks/action', { ...body, mode: 'apply', note: 'REQ-1' });
    assert.equal(applied.status, 200);
    assert.equal(tasks.find((task) => task.TaskID === 'P009-ST1-2').CurrentEnd, '2026-11-07');
    assert.equal(tasks.find((task) => task.TaskID === 'P009-ST2-1').ForecastStart, '2026-11-17');
    assert.equal(audits.at(-1).action, 'Task delayed');
    const retry = await post('/api/integrations/web/tasks/action', { ...body, mode: 'apply' });
    assert.equal(retry.status, 409, 'a retried apply never delays twice');
    const blocked = await post('/api/integrations/web/tasks/action', { groupChatId: '-900', taskId: 'P009-ST1-3', action: 'complete', mode: 'apply' });
    assert.equal(blocked.status, 409);
    assert.match(blocked.body.error, /Waiting for Civil — Drawing/);
    const done = await post('/api/integrations/web/tasks/action', { groupChatId: '-900', taskId: 'P009-ST1-1', action: 'complete', mode: 'apply' });
    assert.equal(done.status, 200);
    assert.equal(tasks.find((task) => task.TaskID === 'P009-ST1-1').Status, 'Completed');
    const late = await post('/api/integrations/web/tasks/action', { groupChatId: '-900', taskId: 'P009-ST1-1', action: 'delay', days: 1, mode: 'preview' });
    assert.equal(late.status, 409);
    assert.match(late.body.error, /Add a new stage instead/);
  } finally { await close(); }
});

test('a task inserted into a stage is appended and the chain is rewired', async () => {
  const { tasks, post, close } = await bridge();
  try {
    await post('/api/integrations/web/stages/add', { groupChatId: '-900', mode: 'apply', stage: { name: 'Civil', placement: { type: 'date', startDate: '2026-11-02' }, tasks: six() } });
    const applied = await post('/api/integrations/web/stages/insert-task', { groupChatId: '-900', mode: 'apply', task: { stageName: 'Civil', afterTaskId: 'P009-ST1-3', title: 'Soil test', durationDays: 2 } });
    assert.equal(applied.status, 200);
    const added = tasks.find((task) => task.TaskID === 'P009-ADD1');
    assert.deepEqual([added.TaskName, added.ForecastStart, added.ForecastEnd], ['Civil — Soil test', '2026-11-06', '2026-11-07']);
    const client = tasks.find((task) => task.TaskID === 'P009-ST1-4');
    assert.deepEqual([client.PredecessorTaskIDs, client.ForecastStart], ['P009-ADD1:FS', '2026-11-08']);
  } finally { await close(); }
});

test('the default plan is served in six-slot stages', async () => {
  const { post, close } = await bridge();
  try {
    const plan = await post('/api/integrations/web/default-plan', {});
    assert.equal(plan.status, 200);
    assert.equal(plan.body.stages[0].name, 'Design plan');
    assert.equal(plan.body.stages[0].tasks.length, 6);
  } finally { await close(); }
});

test('stage wires preview without writes, apply with a fingerprint and protect started work',async()=>{
 const {tasks,post,close}=await bridge();
 try{
  const stage=(name,placement)=>({name,custom:true,placement,tasks:[{key:'inspection',title:'Inspection',role:'Site Supervisor',durationDays:2}]});
  await post('/api/integrations/web/stages/add',{groupChatId:'-900',mode:'apply',stages:[stage('A',{type:'date',startDate:'2026-11-01'}),stage('B',{type:'after',stageName:'A'}),stage('C',{type:'after',stageName:'B'})]});
  assert.equal(tasks.length,3);
  const links=[{source:'A',target:'B',type:'SS'},{source:'A',target:'C',type:'FS'},{source:'B',target:'C',type:'FS'}];
  const route='/api/integrations/web/stages/connections';
  const preview=await post(route,{groupChatId:'-900',mode:'preview',links});assert.equal(preview.status,200);assert.equal(tasks[1].ForecastStart,'2026-11-03');
  assert.equal((await post(route,{groupChatId:'-900',mode:'apply',links,fingerprint:'stale'})).status,409);
  assert.equal((await post(route,{groupChatId:'-900',mode:'apply',links,fingerprint:preview.body.fingerprint})).status,200);
  assert.equal(tasks[1].ForecastStart,'2026-11-01');assert.equal(tasks[2].PredecessorTaskIDs.split(',').length,2);
  tasks[1].ActualStart='2026-11-01';
  assert.equal((await post(route,{groupChatId:'-900',mode:'preview',links:[]})).status,409);
 }finally{await close();}
});
