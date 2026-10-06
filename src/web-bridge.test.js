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
  const store = {
    groupSnapshot: async()=>[{groupChatId:'-456',title:'Site Group',status:'Available',members:[]}],
    rows: async (sheet) => ({ GroupRegistry: groups, GroupMembers: members, Projects: projects }[sheet] || []),
    assignGroupRole: async ({ name, role }) => { members[0].AssignedName = name; members[0].AssignedRole = role; return true; },
    projectForGroup: async (id) => projects.find((project) => project.GroupChatID === id),
    onboardingForMember: async () => null,
    append: async (sheet, row) => { if (sheet === 'Projects') projects.push({ ...row, rowNumber: 2 }); },
    updateRow: async (sheet, number, changes) => Object.assign(projects.find((row)=>row.rowNumber===number),changes),
    audit: async () => {}, markGroupLinked: async () => {},
  };
  const sent = [];
  globalThis.fetch = async (url, options) => {
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
    const role = { groupChatId: '-456', telegramUserId: '123', name: 'Asha Kumar', role: 'Client' };
    assert.equal((await post('/api/integrations/web/group-members', role, false)).status, 401);
    assert.equal((await post('/api/integrations/web/group-members', role)).status, 200);
    assert.equal(members[0].AssignedRole, 'Client');
    assert.equal(sent.length, 1);
    const project = { groupChatId: '-456', projectName: 'Site Group', clientName: 'Asha Kumar', startDate: '2026-09-30' };
    assert.equal((await post('/api/integrations/web/projects', project)).body.projectId, 'P001');
    assert.equal(projects.length, 1);
    assert.equal((await post('/api/integrations/web/projects', project)).body.projectId, 'P001');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    globalThis.fetch = prior.fetch;
    if (prior.secret === undefined) delete process.env.INTEGRATION_SHARED_SECRET; else process.env.INTEGRATION_SHARED_SECRET = prior.secret;
    if (prior.port === undefined) delete process.env.BOT_BRIDGE_PORT; else process.env.BOT_BRIDGE_PORT = prior.port;
  }
});
