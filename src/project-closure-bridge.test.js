import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { startWebBridge } from './web-bridge.js';

test('web closure announces the chosen outcome once and requires integration authentication', async (t) => {
  const before = { secret: process.env.INTEGRATION_SHARED_SECRET, port: process.env.BOT_BRIDGE_PORT, fetch: globalThis.fetch };
  const reserve = net.createServer();
  await new Promise((resolve) => reserve.listen(0, '127.0.0.1', resolve));
  const port = reserve.address().port;
  await new Promise((resolve) => reserve.close(resolve));
  process.env.INTEGRATION_SHARED_SECRET = 'test-secret'; process.env.BOT_BRIDGE_PORT = String(port);
  const projects = ['Completed', 'Abandoned'].map((outcome, index) => ({ ProjectID: `P${index}`, GroupChatID: `-${index + 1}`, ProjectName: `Home ${index}`, Status: 'Active', WebManaged: 'Yes', outcome }));
  const sent = [];
  globalThis.fetch = async (url, options) => {
    assert.ok(String(url).endsWith('/sendMessage'));
    sent.push(JSON.parse(options.body));
    return Response.json({ ok: true, result: { message_id: sent.length } });
  };
  const store = { rows: async () => [{ GroupChatID: '-555' }], projectForGroup: async (id) => projects.find((project) => project.GroupChatID === id), closeProject: async ({ project, outcome }) => { project.Status = outcome; } };
  const server = startWebBridge({ store, token: 'test-token', founderTelegramId: '7' });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    globalThis.fetch = before.fetch;
    if (before.secret === undefined) delete process.env.INTEGRATION_SHARED_SECRET; else process.env.INTEGRATION_SHARED_SECRET = before.secret;
    if (before.port === undefined) delete process.env.BOT_BRIDGE_PORT; else process.env.BOT_BRIDGE_PORT = before.port;
  });
  await new Promise((resolve) => server.once('listening', resolve));
  const post = (input, authorized = true) => before.fetch(`http://127.0.0.1:${port}/api/integrations/web/projects/close`, { method: 'POST', headers: { 'content-type': 'application/json', ...(authorized ? { authorization: 'Bearer test-secret' } : {}) }, body: JSON.stringify(input) });
  assert.equal((await post({ groupChatId: '-1', outcome: 'Completed' }, false)).status, 401);
  assert.equal((await post({ groupChatId: '-1', outcome: 'Deleted' })).status, 400);
  for (const project of projects) {
    const input = { groupChatId: project.GroupChatID, outcome: project.outcome };
    assert.equal((await (await post(input)).json()).announcementStatus, 'Sent');
    assert.equal((await (await post(input)).json()).alreadyClosed, true);
  }
  assert.equal(sent.length, 2);
  assert.match(sent[0].text, /This project is now completed/);
  assert.match(sent[1].text, /This project is now abandoned/);
  assert.equal((await post({ groupChatId: '-1', outcome: 'Abandoned' })).status, 409);
  const setup = await post({ groupChatId: '-555', allowUnstarted: true, projectName: 'Kumar Residence', outcome: 'Abandoned' });
  assert.equal(setup.status, 200);
  assert.equal((await setup.json()).announcementStatus, 'Sent');
  assert.match(sent.at(-1).text, /Kumar Residence/);
  assert.match(sent.at(-1).text, /now abandoned/);
  assert.equal((await post({ groupChatId: '-555', outcome: 'Abandoned' })).status, 404, 'unstarted mode must be explicit');
  assert.equal((await post({ groupChatId: '-999', allowUnstarted: true, projectName: 'Unknown', outcome: 'Abandoned' })).status, 404);
});
