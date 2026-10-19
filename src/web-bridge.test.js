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

test('web bridge assigns a group role and creates a linked project shell', async () => {
  const prior = { secret: process.env.INTEGRATION_SHARED_SECRET, port: process.env.BOT_BRIDGE_PORT, fetch: globalThis.fetch };
  process.env.INTEGRATION_SHARED_SECRET = 'test-secret';
  process.env.BOT_BRIDGE_PORT = String(await freePort());
  const groups = [{ GroupChatID: '-456', GroupTitle: 'Site Group', Status: 'Available', rowNumber: 2 }];
  const members = [{ GroupChatID: '-456', TelegramUserID: '123', TelegramName: 'Asha', MembershipStatus: 'Active', AssignedName: '', AssignedRole: '', rowNumber: 2 }];
  const projects = [];
  const tasks=[];
  const requests=[{RequestID:'req',GroupChatID:'-456',SourceMessageID:'10',AttachmentsJSON:JSON.stringify([{type:'Photo',fileId:'photo'}]),rowNumber:2}];
  const store = {
    groupSnapshot: async()=>[{groupChatId:'-456',title:'Site Group',status:'Available',members:[]}],
    rows: async (sheet) => ({ GroupRegistry: groups, GroupMembers: members, Projects: projects, DecisionRequests:requests,Tasks:tasks }[sheet] || []),
    assignGroupRole: async ({ name, role }) => { members[0].AssignedName = name; members[0].AssignedRole = role; return true; },
    tasksForProject:async(id)=>tasks.filter(t=>t.ProjectID===id),
    projectForGroup: async (id) => projects.find((project) => project.GroupChatID === id),
    onboardingForMember: async () => null,
    append: async (sheet, row) => { if (sheet === 'Projects') projects.push({ ...row, rowNumber: 2 }); if(sheet==='Tasks')tasks.push({...row,rowNumber:tasks.length+2}); },
    updateRow: async (sheet, number, changes) => Object.assign((sheet==='DecisionRequests'?requests:sheet==='Tasks'?tasks:projects).find((row)=>row.rowNumber===number),changes),
    updateRows: async (sheet, list) => { for (const { rowNumber, changes } of list) Object.assign((sheet==='Tasks'?tasks:projects).find((row)=>row.rowNumber===rowNumber),changes); },
    audit: async () => {}, markGroupLinked: async () => {},
  };
  const sent = [];
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/getFile')) return Response.json({ok:true,result:{file_path:'photos/a.jpg'}});
    if(String(url).includes('/file/bot')) return new Response('PHOTO');
    if (String(url).endsWith('/getChatMember')) return Response.json({ ok: true, result: { status: 'member', user: { first_name: 'Asha' } } });
    if (String(url).endsWith('/sendMessage')) { sent.push(JSON.parse(options.body)); return Response.json({ ok: true, result: { message_id: 1 } }); }
    throw new Error(`Unexpected URL: ${url}`);
  };
  const server = startWebBridge({ store, token: 'bot-token', founderTelegramId: '7', onClientReady: async () => {} });
  const base = `http://127.0.0.1:${process.env.BOT_BRIDGE_PORT}`;
  const post = async (route, payload, authorized = true) => {
    const response = await prior.fetch(base + route, { method: 'POST', headers: { 'content-type': 'application/json', ...(authorized ? { authorization: 'Bearer test-secret' } : {}) }, body: JSON.stringify(payload) });
    return { status: response.status, body: await response.json() };
  };
  try {
    await new Promise((resolve) => server.once('listening', resolve));
    assert.equal((await post('/api/integrations/web/groups',{},false)).status,401);
    assert.equal((await post('/api/integrations/web/groups',{})).body.groups[0].groupChatId,'-456');
    const content='/api/integrations/web/decisions/content',publish='/api/integrations/web/decisions/publish';
    const query={requestId:'req',groupChatId:'-456',attachmentIndex:0};
    assert.equal((await post(content,query,false)).status,401);
    assert.equal((await post(content,{...query,groupChatId:'-999'})).status,404);
    assert.equal((await post(content,{...query,attachmentIndex:1})).status,404);
    assert.equal(Buffer.from((await post(content,query)).body.bytes,'base64').toString(),'PHOTO');
    const reply={requestId:'req',groupChatId:'-456',response:'Hello <literal>'};
    assert.equal((await post(publish,reply)).body.result.message_id,1);
    assert.equal(sent[0].text,'Hello <literal>');assert.equal(sent[0].parse_mode,undefined);assert.equal(sent[0].reply_parameters.message_id,10);
    assert.equal((await post(publish,reply)).status,200);assert.equal(sent.length,1);
    assert.equal((await post(publish,{...reply,response:'Different'})).status,409);
    requests[0].PublishedMessageID='';requests[0].ReplyDeliveryStatus='Unknown';
    assert.equal((await post(publish,reply)).status,409);assert.equal(sent.length,1);sent.length=0;
    const role = { groupChatId: '-456', telegramUserId: '123', name: 'Asha Kumar', role: 'Client' };
    assert.equal((await post('/api/integrations/web/group-members', role, false)).status, 401);
    assert.equal((await post('/api/integrations/web/group-members', role)).status, 200);
    assert.equal(members[0].AssignedRole, 'Client');
    assert.equal(sent.length, 1);
    const project = { groupChatId: '-456', projectName: 'Site Group', clientName: 'Asha Kumar', startDate: '2026-09-30' };
    assert.equal((await post('/api/integrations/web/projects', project)).body.projectId, 'P001');
    assert.equal(projects.length, 1);
    const sync='/api/integrations/web/tasks/sync',update={taskId:'WEB-12345678-1234-1234-1234-123456789abc',title:'Follow up',stage:'Design',status:'Completed',deadline:'2026-10-08',assigneeTelegramId:'founder',assigneeName:'Founder'};
    assert.equal((await post(sync,{groupChatId:'-456',updates:[update]},false)).status,401);
    assert.equal((await post(sync,{groupChatId:'-999',updates:[update]})).status,404);
    assert.equal((await post(sync,{groupChatId:'-456',updates:[update]})).body.tasks[0].Status,'Completed');
    assert.equal((await post(sync,{groupChatId:'-456',updates:[update]})).body.tasks.length,1);
    assert.equal((await post(sync,{groupChatId:'-456',updates:[{...update,status:'Archived'}]})).body.tasks[0].Status,'Archived');
    assert.equal((await post(sync,{groupChatId:'-456',updates:[{...update,taskId:'P999-T001'}]})).status,404);

    assert.equal((await post('/api/integrations/web/projects', project)).body.projectId, 'P001');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    globalThis.fetch = prior.fetch;
    if (prior.secret === undefined) delete process.env.INTEGRATION_SHARED_SECRET; else process.env.INTEGRATION_SHARED_SECRET = prior.secret;
    if (prior.port === undefined) delete process.env.BOT_BRIDGE_PORT; else process.env.BOT_BRIDGE_PORT = prior.port;
  }
});

test('web timeline moves are previewed, applied to the sheet, and protected against stale views', async () => {
  const prior = { secret: process.env.INTEGRATION_SHARED_SECRET, port: process.env.BOT_BRIDGE_PORT };
  process.env.INTEGRATION_SHARED_SECRET = 'test-secret';
  process.env.BOT_BRIDGE_PORT = String(await freePort());
  const project = { ProjectID: 'P001', GroupChatID: '-456', WebManaged: 'Yes', TargetEndDate: '2026-03-07', rowNumber: 2 };
  const tasks = [
    { TaskID: 'P001-T1', ProjectID: 'P001', TaskName: 'Drawings', Stage: 'Design', Status: 'Pending', PlannedStart: '2026-03-01', PlannedEnd: '2026-03-03', ForecastStart: '2026-03-01', ForecastEnd: '2026-03-03', rowNumber: 2 },
    { TaskID: 'P001-T2', ProjectID: 'P001', TaskName: 'Carpentry', Stage: 'Site', Status: 'Pending', PlannedStart: '2026-03-04', PlannedEnd: '2026-03-07', ForecastStart: '2026-03-04', ForecastEnd: '2026-03-07', PredecessorTaskIDs: 'P001-T1:FS', rowNumber: 3 },
  ];
  const audits = []; let batches = 0;
  const store = {
    projectForGroup: async (id) => (id === '-456' ? project : undefined),
    rows: async (sheet) => (sheet === 'Tasks' ? tasks : []),
    tasksForProject: async () => tasks.map((task) => ({ ...task })),
    updateRows: async (sheet, list) => { batches += 1; for (const { rowNumber, changes } of list) Object.assign(tasks.find((row) => row.rowNumber === rowNumber), changes); },
    updateRow: async (sheet, rowNumber, changes) => Object.assign(sheet === 'Projects' ? project : tasks.find((row) => row.rowNumber === rowNumber), changes),
    audit: async (entry) => audits.push(entry),
  };
  const server = startWebBridge({ store, token: 'bot-token', founderTelegramId: '7' });
  const post = async (route, payload) => {
    const response = await fetch(`http://127.0.0.1:${process.env.BOT_BRIDGE_PORT}${route}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer test-secret' }, body: JSON.stringify(payload) });
    return { status: response.status, body: await response.json() };
  };
  try {
    const move = { taskId: 'P001-T1', start: '2026-03-02', end: '2026-03-05', fromStart: '2026-03-01', fromEnd: '2026-03-03' };
    const preview = await post('/api/integrations/web/schedule/preview', { groupChatId: '-456', moves: [move] });
    assert.equal(preview.status, 200);
    assert.deepEqual(preview.body.affected.map((item) => [item.taskId, item.forecastStart, item.forecastEnd]), [['P001-T1', '2026-03-02', '2026-03-05'], ['P001-T2', '2026-03-06', '2026-03-09']]);
    assert.equal(tasks[0].ForecastEnd, '2026-03-03', 'preview writes nothing');

    const blocked = await post('/api/integrations/web/schedule/apply', { groupChatId: '-456', moves: [{ taskId: 'P001-T2', start: '2026-03-02', end: '2026-03-05' }] });
    assert.equal(blocked.status, 409);
    assert.match(blocked.body.error, /waits for Drawings to finish/);

    const applied = await post('/api/integrations/web/schedule/apply', { groupChatId: '-456', moves: [move], actorName: 'Founder' });
    assert.equal(applied.status, 200);
    assert.equal(batches, 1, 'one batched sheet write');
    assert.deepEqual([tasks[0].CurrentStart, tasks[0].CurrentEnd, tasks[0].PlannedEnd], ['2026-03-02', '2026-03-05', '2026-03-03'], 'baseline kept');
    assert.deepEqual([tasks[1].ForecastStart, tasks[1].ForecastEnd, tasks[1].CurrentEnd], ['2026-03-06', '2026-03-09', undefined], 'successor forecast only');
    assert.equal(project.TargetEndDate, '2026-03-09');
    assert.equal(audits[0].action, 'Schedule changed');
    assert.match(audits[0].details, /1 dependent task\(s\) also moved/);

    const stale = await post('/api/integrations/web/schedule/apply', { groupChatId: '-456', moves: [move] });
    assert.equal(stale.status, 409);
    assert.match(stale.body.error, /changed since you opened it/);

    const sync = await post('/api/integrations/web/tasks/sync', { groupChatId: '-456', updates: [{ taskId: 'P001-T1', title: 'Drawings', stage: 'Design', status: 'Pending', deadline: '2026-03-06', assigneeTelegramId: '', assigneeName: '' }] });
    assert.equal(sync.status, 200);
    assert.deepEqual([tasks[0].ForecastEnd, tasks[0].PlannedEnd, tasks[1].ForecastStart], ['2026-03-06', '2026-03-03', '2026-03-07'], 'deadline edit reschedules and keeps baseline');
    assert.equal((await post('/api/integrations/web/tasks/sync', { groupChatId: '-456', updates: [{ taskId: 'P001-T1', title: 'Drawings', stage: 'Design', status: 'Pending', deadline: '', assigneeTelegramId: '', assigneeName: '' }] })).status, 200);
    assert.equal(tasks[0].ForecastEnd, '2026-03-06', 'blank deadline never wipes dates');
    const edit = { groupChatId: '-456', taskId: 'P001-T1', fromTitle: 'Drawings', fromRole: 'Team', fromStart: '2026-03-02', fromEnd: '2026-03-06', title: 'Custom drawings', role: 'Team', durationDays: 6, placement: { type: 'keep' }, mode: 'preview' };
    const editPreview = await post('/api/integrations/web/tasks/edit', edit);
    assert.equal(editPreview.status, 200);
    assert.equal(editPreview.body.ok, true);
    assert.equal(tasks[0].TaskName, 'Drawings', 'edit preview writes nothing');
    assert.equal((await post('/api/integrations/web/tasks/edit', { ...edit, mode: 'apply' })).status, 200);
    assert.equal(tasks[0].TaskName, 'Design — Custom drawings');
    assert.equal(tasks[0].ForecastEnd, '2026-03-07');
    assert.equal((await post('/api/integrations/web/tasks/edit', { ...edit, mode: 'apply' })).status, 409);
    const rename = { groupChatId: '-456', stageName: 'Design', name: 'Planning', mode: 'preview' };
    assert.equal((await post('/api/integrations/web/stages/rename', rename)).status, 200);
    assert.equal(tasks[0].Stage, 'Design');
    assert.equal((await post('/api/integrations/web/stages/rename', { ...rename, mode: 'apply' })).status, 200);
    assert.equal(tasks[0].TaskName, 'Planning — Custom drawings');
    assert.equal(tasks[0].ForecastEnd, '2026-03-07', 'rename preserves dates');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (prior.secret === undefined) delete process.env.INTEGRATION_SHARED_SECRET; else process.env.INTEGRATION_SHARED_SECRET = prior.secret;
    if (prior.port === undefined) delete process.env.BOT_BRIDGE_PORT; else process.env.BOT_BRIDGE_PORT = prior.port;
  }
});
