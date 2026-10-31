import test from 'node:test';
import assert from 'node:assert/strict';
import {
  forecastDelayImpact,
  parseDependencyField,
  parseUserDate,
  projectedFinish,
  scheduleDefinitions,
  withForecastDefaults,
  completionBlockReason,
} from './engine.js';
import { SheetStore } from '../storage/sheets.js';

const task = (TaskID, ForecastStart, ForecastEnd, PredecessorTaskIDs = '', Status = 'Pending') => ({
  TaskID,
  TaskName: TaskID,
  ForecastStart,
  ForecastEnd,
  PredecessorTaskIDs,
  Status,
  TemplateVersion: 'T',
});
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
  const afterFirst = Object.values(first).map((item) =>
    item.TaskID === 'B' ? { ...item, Status: 'Delayed — Approved' } : item,
  );
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
    {
      TaskID: 'L2',
      CurrentStart: '2026-03-03',
      CurrentEnd: '2026-03-05',
      PredecessorTaskID: 'L1',
      Status: 'Pending',
    },
  ];
  const result = forecastDelayImpact(withForecastDefaults(legacy), 'L1', 4);
  const { L2 } = byId(result);
  assert.deepEqual([L2.ForecastStart, L2.ForecastEnd], ['2026-03-07', '2026-03-09']);
  assert.equal(projectedFinish(result.tasks), '2026-03-09');
});

test('projected finish stays unconfirmed while any open task is undated', () => {
  assert.equal(projectedFinish([task('A', '2026-03-01', '2026-03-03'), task('B', '', '')]), '');
  assert.equal(
    projectedFinish([
      task('A', '2026-03-01', '2026-03-03'),
      task('B', '', '', '', 'Archived — Superseded plan'),
    ]),
    '2026-03-03',
  );
});

test('dependency types are validated and normalised', () => {
  assert.deepEqual(parseDependencyField(' 10:ss , 20 '), [
    { sequence: '10', type: 'SS' },
    { sequence: '20', type: 'FS' },
  ]);
  assert.throws(() => parseDependencyField('10:FF'), /Unsupported dependency type/);
  assert.throws(() => parseDependencyField('10:SS+2'), /Unsupported dependency type/);
  const predecessor = { TaskID: 'A', TaskName: 'A', Status: 'Pending' };
  assert.match(
    completionBlockReason({ TaskID: 'B', PredecessorTaskIDs: 'A:FF' }, [predecessor]),
    /Unsupported dependency type/,
  );
  assert.match(
    completionBlockReason({ TaskID: 'B', PredecessorTaskIDs: 'A:ss' }, [predecessor]),
    /Waiting for A to start/,
  );
});

test('templates reject duplicate sequences and partial plans have no finish date', () => {
  const definition = (sequence, durationDays, predecessors = []) => ({
    sequence,
    durationDays,
    predecessors,
  });
  assert.throws(
    () =>
      scheduleDefinitions([definition('1', 3), definition('1', 5)], { startDate: '2026-03-01' }),
    /Duplicate template sequence 1/,
  );
  const partial = scheduleDefinitions(
    [definition('1', 3), definition('2', '', [{ sequence: '1', type: 'FS' }])],
    { startDate: '2026-03-01' },
  );
  assert.equal(partial.targetEndDate, '');
  assert.equal(
    scheduleDefinitions([definition('1', 3)], { startDate: '2026-03-01' }).targetEndDate,
    '2026-03-03',
  );
  assert.throws(
    () => scheduleDefinitions([definition('1', 3)], { startDate: '2026-02-30' }),
    /Start date/,
  );
});

test('user dates accept clear formats and reject ambiguous ones', () => {
  const today = new Date('2026-10-15T00:00:00Z');
  assert.equal(parseUserDate('2026-09-20', today), '2026-09-20');
  assert.equal(parseUserDate('20 September', today), '2026-09-20');
  assert.equal(parseUserDate('Sep 20', today), '2026-09-20');
  assert.equal(parseUserDate('5th Jan 2027', today), '2027-01-05');
  assert.equal(parseUserDate('Jan 5', today), '2027-01-05');
  for (const bad of ['2026-02-30', 'tomorrow', '5/1', '31 February', 'Septober 3'])
    assert.equal(parseUserDate(bad, today), null, bad);
});

test('sheet rows keep their physical row numbers when blank rows exist', async () => {
  const store = Object.create(SheetStore.prototype);
  store.request = async () => ({ values: [['TaskID'], ['P1-T5'], [], ['P1-T10']] });
  const rows = await store.rows('Tasks');
  assert.deepEqual(
    rows.map((row) => [row.TaskID, row.rowNumber]),
    [
      ['P1-T5', 2],
      ['P1-T10', 4],
    ],
  );
});
