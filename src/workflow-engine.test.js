import test from 'node:test';
import assert from 'node:assert/strict';
import { rescheduleTasks, forecastDelayImpact, parseDependencyField, parseUserDate, projectedFinish, scheduleDefinitions, withForecastDefaults, completionBlockReason } from './workflow-engine.js';
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
    { rowNumber: 20, WorkflowID: 'INTERIOR-SHEET-V1', Sequence: '10', DurationDays: '1' },
  ];
  store.append = async () => { throw new Error('should not append'); };
  store.appendRows = async () => { throw new Error('should not append'); };
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

const interiorSchedule = async () => {
  const { interiorSheetDefinitions } = await import('./interior-sheet-plan.js');
  const definitions = interiorSheetDefinitions();
  const result = scheduleDefinitions(definitions, { startDate: '2026-11-02' });
  const named = (name) => result.tasks.find((item) => item.taskName === name);
  return { definitions, result, named };
};

test('the founders INTERIOR 1 sheet plan becomes a 68-task graph template', async () => {
  const { definitions } = await interiorSchedule();
  assert.equal(definitions.length, 68);
  const sequences = definitions.map((item) => Number(item.sequence));
  assert.equal(new Set(sequences).size, 68);
  assert.deepEqual(sequences, [...sequences].sort((a, b) => a - b));
  assert.equal(new Set(definitions.map((item) => item.taskName)).size, 68);
  assert.ok(definitions.every((item) => item.workflowId === 'INTERIOR-SHEET-V1' && item.templateVersion === 'INTERIOR-SHEET-V1' && item.defaultRole));
  assert.equal(definitions.find((item) => item.taskName === 'Flooring — Presentation').defaultRole, 'Site Team');
  assert.ok(definitions.some((item) => item.taskName === 'Civil Work — Site Condition Check'));
  assert.deepEqual([...new Set(definitions.filter((item) => item.phase === 'Design').map((item) => item.stage))], ['Design plan', 'Design concept', '3D Design']);
  assert.ok(new Set(definitions.map((item) => item.stage)).has('Plumbing Work (6a)'));
  const { WORKFLOWS, WORKFLOW_OPTIONS } = await import('./schema.js');
  assert.equal(WORKFLOWS['INTERIOR-SHEET-V1'].length, 68);
  assert.ok(WORKFLOW_OPTIONS.some((option) => option.id === 'INTERIOR-SHEET-V1'));
});

test('the INTERIOR 1 plan is dated except the flooring presentation with no sheet duration', async () => {
  const { result, named } = await interiorSchedule();
  const undated = result.tasks.filter((item) => !item.forecastStart).map((item) => item.taskName);
  assert.deepEqual(undated, ['Flooring — Presentation', 'Flooring — Selection and site delivery']);
  assert.equal(named('Flooring — Presentation').unscheduledReason, 'Duration unconfirmed');
  assert.equal(result.targetEndDate, '');
  assert.equal(result.tasks.map((item) => item.forecastEnd).filter(Boolean).sort().at(-1), '2027-04-03');
  assert.deepEqual([named('Existing resources').forecastStart, named('Final Check — Approval').forecastEnd], ['2026-11-02', '2027-04-03']);
});

test('the INTERIOR 1 main lane runs stage after stage and task after task', async () => {
  const { definitions, result } = await interiorSchedule();
  const parallelStages = new Set(['Electrical Work', 'Plumbing Work (6a)', 'Flooring (7a)', 'Ceiling_1', 'Carpentering_Wall (9a)', 'Wall POP', 'Carpentering_Furniture (11a)', 'Corian, Profile Works, Fabrics & Misc (12a)', 'Painting (13a)']);
  const main = result.tasks.filter((item) => !parallelStages.has(item.stage));
  assert.equal(main.length, 47);
  assert.deepEqual(definitions[0].predecessors, []);
  main.forEach((item, index) => {
    if (index === 0) return;
    const previous = main[index - 1];
    assert.deepEqual(item.predecessors, [{ sequence: previous.sequence, type: 'FS' }], item.taskName);
    const dayAfter = new Date(Date.parse(`${previous.forecastEnd}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
    assert.equal(item.forecastStart, dayAfter, item.taskName);
  });
});

test('INTERIOR 1 parallel stages start with their anchor row task', async () => {
  const { result, named } = await interiorSchedule();
  const anchors = [
    ['Electrical Work — Drawing', 'Civil Work — Client Presentation & approval'],
    ['Plumbing Work — Drawing', 'Electrical Work 1 — Drawing approval'],
    ['Flooring — Presentation', 'Plumbing Work — Client Presentation & approval'],
    ['Ceiling_1 — Drawing', 'Flooring — Site Condition Check'],
    ['Carpentering_Wall — Presentation', 'Flooring — Drawing approval'],
    ['Wall POP — Drawing', 'Carpentering_Wall — Site Condition Check'],
    ['Drawings & Presentation', 'Carpentering_Wall — Drawing approval'],
    ['Site Check', 'Carpentering_Furniture — Site Condition Check'],
    ['Painting — Presentation', 'Corian, Profile Works, Fabrics & Misc — Site Execution'],
  ];
  for (const [first, anchor] of anchors) {
    assert.deepEqual(named(first).predecessors, [{ sequence: named(anchor).sequence, type: 'SS' }], first);
    if (named(first).forecastStart) assert.equal(named(first).forecastStart, named(anchor).forecastStart, first);
  }
  assert.equal(result.tasks.filter((item) => item.predecessors.some((edge) => edge.type === 'SS')).length, anchors.length);
});

test('INTERIOR 1 items sharing an order number run side by side', async () => {
  const { named } = await interiorSchedule();
  const drawings = named('Drawings & Presentation');
  const approval = named('Carpentering_Furniture — Approval');
  const selection = named('Carpentering_Furniture — Selection and site delivery');
  for (const item of [approval, selection]) {
    assert.deepEqual(item.predecessors, [{ sequence: drawings.sequence, type: 'FS' }]);
    assert.equal(item.forecastStart, '2027-02-04');
  }
  assert.deepEqual([approval.forecastEnd, selection.forecastEnd], ['2027-02-09', '2027-02-18']);
});

test('order groups wait for every item of the previous group, across stages too', async () => {
  const { sheetPlanDefinitions } = await import('./interior-sheet-plan.js');
  const definitions = sheetPlanDefinitions([
    { code: '1', name: 'Design plan', lane: 'main', tasks: [[1, '1', 'Brief', 1, 'Designer'], [2, '2', 'Plan A', 2, null], [3, '2', 'Plan B', 4, 'Designer']] },
    { code: '2', name: 'Civil', lane: 'main', tasks: [[4, '1', 'Check', 1, 'Site Supervisor'], [5, '2', 'Build', 3, 'Mason']] },
    { code: '2a', name: 'Civil drawings', lane: 'parallel', anchor: { stageCode: '2', row: 5 }, tasks: [[5, '1', 'Draw', 2, 'Designer'], [6, '2', 'Approve', 1, 'Design Head']] },
  ]);
  const bySequence = (sequence) => definitions.find((item) => item.sequence === sequence);
  assert.deepEqual(bySequence('20').predecessors, [{ sequence: '10', type: 'FS' }]);
  assert.deepEqual(bySequence('30').predecessors, [{ sequence: '10', type: 'FS' }]);
  assert.deepEqual(bySequence('40').predecessors, [{ sequence: '20', type: 'FS' }, { sequence: '30', type: 'FS' }]);
  assert.deepEqual(bySequence('60').predecessors, [{ sequence: '50', type: 'SS' }]);
  assert.equal(bySequence('20').defaultRole, 'Site Team');
  const result = scheduleDefinitions(definitions, { startDate: '2026-11-02' });
  const dates = Object.fromEntries(result.tasks.map((item) => [item.taskName, [item.forecastStart, item.forecastEnd]]));
  assert.deepEqual(dates['Plan A'], ['2026-11-03', '2026-11-04']);
  assert.deepEqual(dates['Plan B'], ['2026-11-03', '2026-11-06']);
  assert.deepEqual(dates.Check, ['2026-11-07', '2026-11-07']);
  assert.deepEqual(dates.Draw, ['2026-11-08', '2026-11-09']);
  assert.equal(result.targetEndDate, '2026-11-10');
});

test('seeding a sheet without the INTERIOR 1 plan writes it in one batched append', async () => {
  const store = Object.create(SheetStore.prototype);
  const batches = [];
  store.rows = async () => ['HOUSE-V1', 'RESTORATION-V1', 'PAINTING-V1', 'INTERIOR-V1', 'RESIDENTIAL-INTERIOR-V1'].map((WorkflowID, index) => ({ rowNumber: 2 + index, WorkflowID, Sequence: '5', DurationDays: '1' }));
  store.append = async () => { throw new Error('should not append row by row'); };
  store.updateRow = async () => {};
  store.updateRows = async () => {};
  store.appendRows = async (sheet, objects) => batches.push({ sheet, objects });
  await store.seedDefaultWorkflows();
  assert.equal(batches.length, 1);
  assert.equal(batches[0].sheet, 'WorkflowTemplates');
  assert.equal(batches[0].objects.length, 68);
  assert.deepEqual([batches[0].objects[1].TaskName, batches[0].objects[1].DependencySequences, batches[0].objects[1].TemplateVersion], ['2D drawing', '10:FS', 'INTERIOR-SHEET-V1']);
});

test('appendRows sends every row in a single values:append request', async () => {
  const store = Object.create(SheetStore.prototype);
  const calls = [];
  store.request = async (path, options) => calls.push({ path, body: JSON.parse(options.body) });
  await store.appendRows('Users', [{ TelegramUserID: '1', Name: 'A' }, { TelegramUserID: '2', Name: 'B', Active: 'Yes' }], { raw: true });
  await store.appendRows('Users', []);
  assert.equal(calls.length, 1);
  assert.match(calls[0].path, /:append\?valueInputOption=RAW&insertDataOption=INSERT_ROWS$/);
  assert.deepEqual(calls[0].body.values, [['1', 'A', '', ''], ['2', 'B', '', 'Yes']]);
});


test('explicit moves update sheet dependencies while keeping planned dates',()=>{
 const tasks=chain();tasks.forEach((row,i)=>{row.Sequence=String((i+1)*10);row.PlannedStart=row.ForecastStart;row.PlannedEnd=row.ForecastEnd;});
 const move={taskId:'B',fromStart:'2026-03-04',fromEnd:'2026-03-05',start:'2026-03-02',end:'2026-03-03'};
 const parallel=rescheduleTasks(tasks,[move],{mode:'parallel'});
 assert.equal(byId(parallel).B.PredecessorTaskIDs,'');
 assert.equal(byId(parallel).C.PredecessorTaskIDs,'');
 assert.equal(byId(parallel).B.PlannedStart,'2026-03-04');
 assert.equal(byId(parallel).C.ForecastStart,'2026-03-06');
 const cascade=rescheduleTasks(tasks,[move],{mode:'shift-following'});
 assert.equal(byId(cascade).C.ForecastStart,'2026-03-04');
 assert.equal(byId(cascade).C.PredecessorTaskIDs,'B:FS');
 assert.equal(byId(cascade).B.PredecessorTaskID,'');
 assert.equal(tasks[1].PredecessorTaskIDs,'A:FS');
});
