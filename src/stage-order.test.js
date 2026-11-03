import test from 'node:test';
import assert from 'node:assert/strict';
import { taskPlanFingerprint, validateStageOrder, createStageOrderBridge } from './stage-order.js';
import { SheetStore } from './sheets.js';
const fixture = () =>
  ['Resources', 'Discovery', 'Planning'].map((Stage, i) => ({
    TaskID: `t${i}`,
    ProjectID: 'P1',
    Stage,
    Sequence: String(i * 10 + 5),
    Status: 'Pending',
    PlannedStart: `2026-10-0${i * 2 + 1}`,
    PlannedEnd: `2026-10-0${i * 2 + 2}`,
    PredecessorTaskID: i ? `t${i - 1}` : '',
    PredecessorTaskIDs: '',
    rowNumber: i + 2,
  }));
const plan = (rows) => ({
  fingerprint: taskPlanFingerprint(rows),
  stageOrder: ['Resources', 'Planning', 'Discovery'],
  tasks: [
    { id: 't0', start: '2026-10-01', end: '2026-10-02', dependencies: [] },
    { id: 't1', start: '2026-10-05', end: '2026-10-06', dependencies: [{ id: 't2', type: 'FS' }] },
    { id: 't2', start: '2026-10-03', end: '2026-10-04', dependencies: [{ id: 't0', type: 'FS' }] },
  ],
});
test('bot validates the confirmed plan, preserves original baseline dates and assigns new sequence order', () => {
  const rows = fixture(),
    result = validateStageOrder(rows, plan(rows));
  assert.deepEqual(
    result.map((row) => row.Stage),
    ['Resources', 'Planning', 'Discovery'],
  );
  assert.equal(result[1].ForecastStart, '2026-10-03');
  assert.equal(result[1].PlannedStart, '2026-10-05');
  assert.equal(result[2].PredecessorTaskIDs, 't2:FS');
  assert.equal(rows[1].Sequence, '15');
});
test('bot refuses stale snapshots, resized tasks, changed completed work and dependency cycles', () => {
  const rows = fixture();
  const stale = plan(rows);
  rows[1].Status = 'Completed';
  assert.throws(() => validateStageOrder(rows, stale), /plan changed/);
  assert.throws(() => validateStageOrder(rows, plan(rows)), /Started or finished/);
  const fresh = fixture(),
    resized = plan(fresh);
  resized.tasks[1].end = '2026-10-07';
  assert.throws(() => validateStageOrder(fresh, resized), /duration/);
  const cycle = plan(fresh);
  for (const task of cycle.tasks) {
    task.start = '2026-10-01';
    task.end = '2026-10-02';
    task.dependencies = [{ id: `t${(Number(task.id[1]) + 1) % 3}`, type: 'SS' }];
  }
  assert.throws(() => validateStageOrder(fresh, cycle), /cycle/);
});
test('bridge snapshots do not write and confirmed application uses one persistence operation', async () => {
  let saves = 0;
  const rows = fixture();
  const store = {
    projectForGroup: async () => ({ ProjectID: 'P1', Status: 'Active' }),
    tasksForProject: async () => rows,
    saveStageOrder: async () => {
      saves++;
    },
  };
  const bridge = createStageOrderBridge({ store, founderTelegramId: '42' });
  assert.deepEqual((await bridge({ groupChatId: '-1', mode: 'snapshot' })).stageOrder, [
    'Resources',
    'Discovery',
    'Planning',
  ]);
  assert.equal(saves, 0);
  await bridge({ ...plan(rows), groupChatId: '-1', mode: 'apply' });
  assert.equal(saves, 1);
});
test('all reordered fields and project finish are sent in one RAW Sheets batch', async () => {
  const store = Object.create(SheetStore.prototype);
  const calls = [];
  store.request = async (route, options) => {
    calls.push({ route, body: JSON.parse(options.body) });
  };
  const rows = fixture();
  await store.saveStageOrder({ rowNumber: 2 }, validateStageOrder(rows, plan(rows)), '42');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].route, '/values:batchUpdate');
  assert.equal(calls[0].body.valueInputOption, 'RAW');
  assert.ok(
    calls[0].body.data.some(
      (row) => row.range.startsWith('Projects!') && row.values[0][0] === '2026-10-06',
    ),
  );
});
