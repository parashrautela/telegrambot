import test from 'node:test';
import assert from 'node:assert/strict';
import { forecastDelayImpact, parseDependencyField, parseUserDate, projectedFinish, scheduleDefinitions, withForecastDefaults, completionBlockReason } from './workflow-engine.js';
import { SheetStore } from './sheets.js';

const task = (TaskID, ForecastStart, ForecastEnd, PredecessorTaskIDs = '', Status = 'Pending') => ({ TaskID, TaskName: TaskID, ForecastStart, ForecastEnd, PredecessorTaskIDs, Status, TemplateVersion: 'T' });
const byId = (result) => Object.fromEntries(result.tasks.map((item) => [item.TaskID, item]));
const chain = () => [
  task('A', '2026-03-01', '2026-03-03'),
  task('B', '2026-03-04', '2026-03-05', 'A:FS'),
  task('C', '2026-03-06', '2026-03-07', 'B:FS'),
];

test('a task waiting on delay approval shifts instead of stretching', () => {
  const tasks = chain();
  tasks[0].Status = 'Delay Requested';
  const { A, B, C } = byId(forecastDelayImpact(tasks, 'A', 2));
  assert.deepEqual([A.ForecastStart, A.ForecastEnd], ['2026-03-03', '2026-03-05']);
  assert.deepEqual([B.ForecastStart, C.ForecastStart], ['2026-03-06', '2026-03-08']);
});

test('an approved delay does not block a later upstream delay', () => {
  const first = byId(forecastDelayImpact(chain(), 'B', 2));
  const afterFirst = Object.values(first).map((item) => (item.TaskID === 'B' ? { ...item, Status: 'Delayed — Approved' } : item));
  const { A, B, C } = byId(forecastDelayImpact(afterFirst, 'A', 5));
  assert.equal(A.ForecastEnd, '2026-03-08');
  assert.equal(B.ForecastStart, '2026-03-09');
  assert.equal(C.ForecastStart, '2026-03-11');
});

test('an upstream delay never pulls a downstream task earlier', () => {
  const tasks = chain();
  tasks[1] = task('B', '2026-03-14', '2026-03-15', 'A:FS');
  const { B, C } = byId(forecastDelayImpact(tasks, 'A', 1));
  assert.equal(B.ForecastStart, '2026-03-14');
  assert.equal(C.ForecastStart, '2026-03-16');
});

test('downstream recalculation does not depend on row order', () => {
  const tasks = [
    task('A', '2026-03-01', '2026-03-03'),
    task('X', '2026-03-06', '2026-03-06', 'A:FS,B:FS'),
    task('B', '2026-03-04', '2026-03-05', 'A:FS'),
  ];
  const { X, B } = byId(forecastDelayImpact(tasks, 'A', 3));
  assert.equal(B.ForecastEnd, '2026-03-08');
  assert.equal(X.ForecastStart, '2026-03-09');
});

test('legacy plans propagate delays once forecasts are seeded from current dates', () => {
  const legacy = [
    { TaskID: 'L1', CurrentStart: '2026-03-01', CurrentEnd: '2026-03-02', Status: 'Pending' },
    { TaskID: 'L2', CurrentStart: '2026-03-03', CurrentEnd: '2026-03-05', PredecessorTaskID: 'L1', Status: 'Pending' },
  ];
  const result = forecastDelayImpact(withForecastDefaults(legacy), 'L1', 4);
  const { L2 } = byId(result);
  assert.deepEqual([L2.ForecastStart, L2.ForecastEnd], ['2026-03-07', '2026-03-09']);
  assert.equal(projectedFinish(result.tasks), '2026-03-09');
});

test('projected finish stays unconfirmed while any open task is undated', () => {
  assert.equal(projectedFinish([task('A', '2026-03-01', '2026-03-03'), task('B', '', '')]), '');
  assert.equal(projectedFinish([task('A', '2026-03-01', '2026-03-03'), task('B', '', '', '', 'Archived — Superseded plan')]), '2026-03-03');
});

test('dependency types are validated and normalised', () => {
  assert.deepEqual(parseDependencyField(' 10:ss , 20 '), [{ sequence: '10', type: 'SS' }, { sequence: '20', type: 'FS' }]);
  assert.throws(() => parseDependencyField('10:FF'), /Unsupported dependency type/);
  assert.throws(() => parseDependencyField('10:SS+2'), /Unsupported dependency type/);
  const predecessor = { TaskID: 'A', TaskName: 'A', Status: 'Pending' };
  assert.match(completionBlockReason({ TaskID: 'B', PredecessorTaskIDs: 'A:FF' }, [predecessor]), /Unsupported dependency type/);
  assert.match(completionBlockReason({ TaskID: 'B', PredecessorTaskIDs: 'A:ss' }, [predecessor]), /Waiting for A to start/);
});

test('templates reject duplicate sequences and partial plans have no finish date', () => {
  const definition = (sequence, durationDays, predecessors = []) => ({ sequence, durationDays, predecessors });
  assert.throws(() => scheduleDefinitions([definition('1', 3), definition('1', 5)], { startDate: '2026-03-01' }), /Duplicate template sequence 1/);
  const partial = scheduleDefinitions([definition('1', 3), definition('2', '', [{ sequence: '1', type: 'FS' }])], { startDate: '2026-03-01' });
  assert.equal(partial.targetEndDate, '');
  assert.equal(scheduleDefinitions([definition('1', 3)], { startDate: '2026-03-01' }).targetEndDate, '2026-03-03');
  assert.throws(() => scheduleDefinitions([definition('1', 3)], { startDate: '2026-02-30' }), /Start date/);
});

test('user dates accept clear formats and reject ambiguous ones', () => {
  const today = new Date('2026-10-15T00:00:00Z');
  assert.equal(parseUserDate('2026-09-20', today), '2026-09-20');
  assert.equal(parseUserDate('20 September', today), '2026-09-20');
  assert.equal(parseUserDate('Sep 20', today), '2026-09-20');
  assert.equal(parseUserDate('5th Jan 2027', today), '2027-01-05');
  assert.equal(parseUserDate('Jan 5', today), '2027-01-05');
  for (const bad of ['2026-02-30', 'tomorrow', '5/1', '31 February', 'Septober 3']) assert.equal(parseUserDate(bad, today), null, bad);
});

test('sheet rows keep their physical row numbers when blank rows exist', async () => {
  const store = Object.create(SheetStore.prototype);
  store.request = async () => ({ values: [['TaskID'], ['P1-T5'], [], ['P1-T10']] });
  const rows = await store.rows('Tasks');
  assert.deepEqual(rows.map((row) => [row.TaskID, row.rowNumber]), [['P1-T5', 2], ['P1-T10', 4]]);
});

test('the residential template is fully dated from the founders sheet durations', async () => {
  const { residentialInteriorDefinitions } = await import('./residential-interior.js');
  const definitions = residentialInteriorDefinitions();
  assert.equal(definitions.length, 42);
  const result = scheduleDefinitions(definitions, { startDate: '2026-11-02' });
  assert.equal(result.tasks.filter((item) => !item.forecastStart).length, 0);
  assert.equal(result.targetEndDate, '2026-12-24');
  const carpentry = result.tasks.find((item) => item.sequence === '410');
  assert.deepEqual([carpentry.forecastStart, carpentry.forecastEnd], ['2026-11-21', '2026-12-10']);
});

test('seeding fills blank template durations without overwriting founder edits', async () => {
  const store = Object.create(SheetStore.prototype);
  const writes = [];
  store.rows = async () => [
    { rowNumber: 2, WorkflowID: 'RESIDENTIAL-INTERIOR-V1', Sequence: '5', DurationDays: '' },
    { rowNumber: 3, WorkflowID: 'RESIDENTIAL-INTERIOR-V1', Sequence: '410', DurationDays: '25' },
    ...['HOUSE-V1', 'RESTORATION-V1', 'PAINTING-V1', 'INTERIOR-V1'].map((WorkflowID, index) => ({ rowNumber: 10 + index, WorkflowID, Sequence: '5', DurationDays: '1' })),
  ];
  store.append = async () => { throw new Error('should not append'); };
  store.updateRow = async () => {};
  store.updateRows = async (sheet, changes) => writes.push(...changes);
  await store.seedDefaultWorkflows();
  assert.deepEqual(writes, [{ rowNumber: 2, changes: { DurationDays: '1' } }]);
});

test('moving a task later pushes its successors and reports every change', async () => {
  const { rescheduleTasks } = await import('./workflow-engine.js');
  const result = rescheduleTasks(chain(), [{ taskId: 'A', start: '2026-03-02', end: '2026-03-06' }]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.affected.map((item) => [item.taskId, item.forecastStart, item.forecastEnd, item.moved]), [
    ['A', '2026-03-02', '2026-03-06', true], ['B', '2026-03-07', '2026-03-08', false], ['C', '2026-03-09', '2026-03-10', false],
  ]);
  assert.equal(result.finish, '2026-03-10');
});

test('moving a task earlier never pulls successors and cannot jump its own predecessor', async () => {
  const { rescheduleTasks } = await import('./workflow-engine.js');
  const earlier = rescheduleTasks(chain(), [{ taskId: 'C', start: '2026-03-06', end: '2026-03-06' }]);
  assert.equal(earlier.ok, true);
  const blocked = rescheduleTasks(chain(), [{ taskId: 'B', start: '2026-03-02', end: '2026-03-03' }]);
  assert.equal(blocked.ok, false);
  assert.match(blocked.conflicts[0].reason, /cannot start before 4 Mar 2026: it waits for A to finish/);
  assert.deepEqual(blocked.affected, []);
});

test('swapping two independent tasks exchanges their slots', async () => {
  const { rescheduleTasks } = await import('./workflow-engine.js');
  const tasks = [task('P', '2026-03-01', '2026-03-02'), task('Q', '2026-03-05', '2026-03-07')];
  const result = rescheduleTasks(tasks, [{ taskId: 'P', start: '2026-03-05', end: '2026-03-06' }, { taskId: 'Q', start: '2026-03-01', end: '2026-03-03' }]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.affected.map((item) => [item.taskId, item.forecastStart, item.forecastEnd]), [['P', '2026-03-05', '2026-03-06'], ['Q', '2026-03-01', '2026-03-03']]);
});

test('completed work cannot be moved and started successors are warned about, not moved', async () => {
  const { rescheduleTasks } = await import('./workflow-engine.js');
  const done = chain(); done[0].Status = 'Completed';
  assert.match(rescheduleTasks(done, [{ taskId: 'A', start: '2026-03-02', end: '2026-03-04' }]).conflicts[0].reason, /Completed/);
  const started = chain(); started[1].Status = 'In Progress';
  const result = rescheduleTasks(started, [{ taskId: 'A', start: '2026-03-01', end: '2026-03-05' }]);
  assert.equal(result.ok, true);
  assert.equal(result.warnings[0].taskId, 'B');
  assert.equal(result.affected.find((item) => item.taskId === 'C'), undefined);
});
