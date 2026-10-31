import test from 'node:test';
import assert from 'node:assert/strict';
import { createFounderHandlers } from './founder-commands.js';
import { createGroupHandlers } from './group-commands.js';
import { createProjectHandlers } from './projects.js';

const config = { founderTelegramId: '1', leaderToken: 'test-leader', groupToken: 'test-group' };
const denyStoreAccess = new Proxy(
  {},
  {
    get() {
      throw new Error('Unexpected data access');
    },
  },
);

function telegram(t) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return { json: async () => ({ ok: true, result: {} }) };
  });
  return calls;
}

test('importing bot startup does not contact services or require credentials', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', () => {
    throw new Error('Unexpected network call');
  });
  const { startBot } = await import('./application.js');
  assert.equal(typeof startBot, 'function');
  assert.equal(fetch.mock.callCount(), 0);
});

test('extracted founder handlers reject other users before accessing project data', async (t) => {
  const calls = telegram(t);
  const handlers = createFounderHandlers({ config, store: denyStoreAccess });
  await handlers.leaderCommand({ text: '/projects', from: { id: 2 }, chat: { id: 2 } });
  assert.equal(calls.length, 0);
  await handlers.leaderCommand({ text: '/help', from: { id: 1 }, chat: { id: 1 } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.chat_id, 1);
  assert.match(calls[0].body.text, /Founder bot commands/);
});

test('closed projects cannot reach group task updates', async (t) => {
  const calls = telegram(t);
  const handlers = createGroupHandlers({
    config,
    store: { projectForGroup: async () => ({ Status: 'Completed' }) },
  });
  const project = await handlers.requireProject(
    { id: -123, type: 'supergroup' },
    config.groupToken,
  );
  assert.equal(project, null);
  assert.match(calls[0].body.text, /updates are closed/);
});

test('project summaries retain blockers and escape user-supplied names', async () => {
  const store = {
    tasksForProject: async () => [
      { Sequence: '1', Status: 'Completed', TaskName: 'Brief', Stage: 'Resources' },
      { Sequence: '2', Status: 'Issue Reported', TaskName: 'Design <review>', Stage: 'Design' },
    ],
    approvals: async () => [{ ProjectID: 'P001' }],
  };
  const handlers = createProjectHandlers({ config, store });
  const summary = await handlers.projectTldr({ ProjectID: 'P001', ProjectName: 'Home <A>' });
  assert.match(summary, /Home &lt;A&gt;/);
  assert.match(summary, /1\/2 tasks complete/);
  assert.match(summary, /1 reported issue/);
  assert.match(summary, /1 approval pending/);
});
