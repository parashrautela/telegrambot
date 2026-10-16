import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { STAGE_TASKS, buildStageTasks, buildStagePlan, insertStageTask, planTaskAction, defaultPlanStages, scheduleSentence } from './stage-plan.js';
import { rescheduleTasks } from './workflow-engine.js';

const six = (days = [1, 2, 1, 1, 5, 2]) => STAGE_TASKS.map((task, index) => ({ key: task.key, durationDays: days[index] }));
const options = { projectId: 'P001', today: '2026-10-16' };
const withRowNumbers = (rows, offset = 2) => rows.map((row, index) => ({ ...row, rowNumber: offset + index }));

test('a new stage is six tasks in a row with no overlap', () => {
  const { rows, stage } = buildStageTasks([], { name: 'Civil', placement: { type: 'date', startDate: '2026-11-02' }, tasks: six() }, options);
  assert.equal(rows.length, 6);
  assert.deepEqual(rows.map((row) => [row.ForecastStart, row.ForecastEnd]), [
    ['2026-11-02', '2026-11-02'], ['2026-11-03', '2026-11-04'], ['2026-11-05', '2026-11-05'],
    ['2026-11-06', '2026-11-06'], ['2026-11-07', '2026-11-11'], ['2026-11-12', '2026-11-13'],
  ]);
  assert.deepEqual(stage, { name: 'Civil', startDate: '2026-11-02', endDate: '2026-11-13' });
  assert.equal(rows[0].TaskName, 'Civil — Site Condition Check');
  assert.equal(rows[0].PredecessorTaskIDs, '');
  assert.equal(rows[1].PredecessorTaskIDs, 'P001-ST1-1:FS');
  assert.deepEqual(rows.map((row) => Number(row.Sequence)), [10, 20, 30, 40, 50, 60]);
  assert.ok(rows.every((row) => row.WorkflowID === 'WEB-STAGE' && row.Status === 'Pending'));
  assert.equal(rows[3].Audience, 'client');
});

test('a stage placed after another starts the day after it ends', () => {
  const civil = withRowNumbers(buildStageTasks([], { name: 'Civil', placement: { type: 'date', startDate: '2026-11-02' }, tasks: six() }, options).rows);
  const { rows } = buildStageTasks(civil, { name: 'Flooring', tasks: six() }, options);
  assert.equal(rows[0].ForecastStart, '2026-11-14');
  assert.equal(rows[0].PredecessorTaskIDs, 'P001-ST1-6:FS');
  assert.equal(rows[0].TaskID, 'P001-ST2-1');
  assert.equal(Number(rows[0].Sequence), 70);
});

test('a parallel stage starts with the first task of its partner stage', () => {
  const civil = withRowNumbers(buildStageTasks([], { name: 'Civil', placement: { type: 'date', startDate: '2026-11-02' }, tasks: six() }, options).rows);
  const { rows } = buildStageTasks(civil, { name: 'Electrical', placement: { type: 'parallel', stageName: 'civil' }, tasks: six() }, options);
  assert.equal(rows[0].ForecastStart, '2026-11-02');
  assert.equal(rows[0].PredecessorTaskIDs, 'P001-ST1-1:SS');
  assert.equal(rows[0].DependencyType, 'SS');
});

test('skipped tasks are left out and their neighbours link up', () => {
  const { rows } = buildStageTasks([], { name: 'Check', placement: { type: 'date', startDate: '2026-11-02' }, tasks: six([1, 0, 0, 1, 0, 2]) }, options);
  assert.deepEqual(rows.map((row) => row.TaskName.split(' — ')[1]), ['Site Condition Check', 'Client Presentation & approval', 'Final check']);
  assert.equal(rows[1].PredecessorTaskIDs, 'P001-ST1-1:FS');
  assert.equal(rows[2].PredecessorTaskIDs, 'P001-ST1-4:FS');
  assert.equal(rows[2].ForecastStart, '2026-11-04');
});

test('an ongoing stage keeps its real start date and marks finished tasks done', () => {
  const { rows } = buildStageTasks([], { name: 'Plumbing', placement: { type: 'date', startDate: '2026-10-10' }, doneCount: 2, tasks: six() }, options);
  assert.deepEqual(rows.map((row) => row.Status), ['Completed', 'Completed', 'Pending', 'Pending', 'Pending', 'Pending']);
  assert.equal(rows[1].ActualEnd, '2026-10-12');
  assert.equal(rows[2].ActualEnd, '');
});

test('stage names are unique and inputs are validated', () => {
  const civil = withRowNumbers(buildStageTasks([], { name: 'Civil', placement: { type: 'date', startDate: '2026-11-02' }, tasks: six() }, options).rows);
  assert.throws(() => buildStageTasks(civil, { name: ' civil ', tasks: six() }, options), (error) => error.status === 409 && /Civil \(2\)/.test(error.message));
  assert.throws(() => buildStageTasks([], { name: '', tasks: six() }, options), /stage name/);
  assert.throws(() => buildStageTasks([], { name: 'A — B', tasks: six() }, options), /cannot contain/);
  assert.throws(() => buildStageTasks([], { name: 'X', tasks: six([0, 0, 0, 0, 0, 0]) }, options), /at least one task/);
  assert.throws(() => buildStageTasks([], { name: 'X', tasks: [{ key: 'nope', durationDays: 1 }] }, options), /Unknown stage task/);
  assert.throws(() => buildStageTasks([], { name: 'X', tasks: six([1.5, 1, 1, 1, 1, 1]) }, options), /whole days/);
  assert.throws(() => buildStageTasks([], { name: 'X', doneCount: 7, tasks: six() }, options), /already done/);
  assert.throws(() => buildStageTasks(civil, { name: 'X', placement: { type: 'after', stageName: 'Ghost' }, tasks: six() }, options), (error) => error.status === 404);
});

test('a stage after an undated stage stays unscheduled with a reason', () => {
  const undated = [{ TaskID: 'P001-T10', Stage: 'Design', TaskName: 'Design', Sequence: '10', Status: 'Pending', rowNumber: 2 }];
  const { rows, warnings } = buildStageTasks(undated, { name: 'Civil', tasks: six() }, options);
  assert.equal(rows[0].ForecastStart, '');
  assert.match(rows[0].BlockedReason, /predecessor/);
  assert.equal(warnings.length, 1);
});

test('people are matched by role only when exactly one member has it', () => {
  const members = [
    { MembershipStatus: 'Active', AssignedRole: 'Designer', TelegramUserID: '11', AssignedName: 'Riya' },
    { MembershipStatus: 'Active', AssignedRole: 'site supervisor', TelegramUserID: '12', AssignedName: 'Mohan' },
    { MembershipStatus: 'Active', AssignedRole: 'Site Supervisor', TelegramUserID: '13', AssignedName: 'Sunil' },
  ];
  const tasks = six().map((task) => (task.key === 'execution' ? { ...task, role: 'Tile person', assigneeTelegramId: '55', assigneeName: 'Ravi' } : task));
  const { rows } = buildStageTasks([], { name: 'Civil', placement: { type: 'date', startDate: '2026-11-02' }, tasks }, { ...options, groupMembers: members });
  assert.equal(rows[0].AssignedTelegramID, '');
  assert.equal(rows[1].AssignedName, 'Riya');
  assert.equal(rows[4].AssignedRole, 'Tile person');
  assert.equal(rows[4].AssignedName, 'Ravi');
});

test('the default plan converts to six-slot stages that build into a dated plan', () => {
  const stages = defaultPlanStages();
  assert.equal(stages.length, 21);
  assert.ok(stages.every((stage) => stage.tasks.length === 6));
  assert.deepEqual(stages[0].placement, { type: 'date' });
  assert.equal(stages.find((stage) => stage.name === 'Flooring (prep)').placement.stageName, 'Plumbing Work');
  assert.equal(stages.find((stage) => stage.name === 'Carpentering Wall').tasks.find((task) => task.key === 'execution').role, 'Carpenter');
  stages[0].placement.startDate = '2026-11-02';
  const { rows, stages: built } = buildStagePlan([], stages, options);
  assert.equal(new Set(built.map((stage) => stage.name)).size, stages.length);
  assert.ok(rows.every((row) => row.ForecastStart && row.ForecastEnd), 'every default task is dated');
  assert.equal(new Set(rows.map((row) => row.TaskID)).size, rows.length);
});

test('a task inserted inside a stage sits between its neighbours and pushes the rest', () => {
  const civil = withRowNumbers(buildStageTasks([], { name: 'Civil', placement: { type: 'date', startDate: '2026-11-02' }, tasks: six() }, options).rows);
  const flooring = withRowNumbers(buildStageTasks(civil, { name: 'Flooring', tasks: six() }, options).rows, 8);
  const all = [...civil, ...flooring];
  const { row, rewire } = insertStageTask(all, { stageName: 'Civil', afterTaskId: 'P001-ST1-3', title: 'Soil test', durationDays: 2 }, options);
  assert.equal(row.TaskID, 'P001-ADD1');
  assert.equal(row.ForecastStart, '2026-11-06');
  assert.ok(Number(row.Sequence) > 30 && Number(row.Sequence) < 40);
  assert.deepEqual(rewire.map((item) => [item.taskId, item.PredecessorTaskIDs]), [['P001-ST1-4', 'P001-ADD1:FS']]);
  const rewired = all.map((task) => {
    const change = rewire.find((item) => item.taskId === task.TaskID);
    return change ? { ...task, PredecessorTaskIDs: change.PredecessorTaskIDs } : task;
  });
  const result = rescheduleTasks([...rewired, row], []);
  assert.equal(result.ok, true);
  const client = result.tasks.find((task) => task.TaskID === 'P001-ST1-4');
  assert.equal(client.ForecastStart, '2026-11-08');
  assert.equal(result.tasks.find((task) => task.TaskID === 'P001-ST2-1').ForecastStart, '2026-11-16');
});

test('a task added after the last task of a stage also holds back the next stage', () => {
  const civil = withRowNumbers(buildStageTasks([], { name: 'Civil', placement: { type: 'date', startDate: '2026-11-02' }, tasks: six() }, options).rows);
  const flooring = withRowNumbers(buildStageTasks(civil, { name: 'Flooring', tasks: six() }, options).rows, 8);
  const { rewire } = insertStageTask([...civil, ...flooring], { stageName: 'Civil', afterTaskId: 'P001-ST1-6', title: 'Snag list', durationDays: 1 }, options);
  assert.deepEqual(rewire.map((item) => item.taskId), ['P001-ST2-1']);
});

test('delay, redo and complete turn into moves and status changes', () => {
  const rows = withRowNumbers(buildStageTasks([], { name: 'Civil', placement: { type: 'date', startDate: '2026-11-02' }, tasks: six() }, options).rows);
  const delay = planTaskAction(rows, { taskId: 'P001-ST1-2', action: 'delay', days: 3 }, { today: '2026-11-03' });
  assert.deepEqual(delay.moves, [{ taskId: 'P001-ST1-2', start: '2026-11-03', end: '2026-11-07' }]);
  const result = rescheduleTasks(rows, delay.moves);
  assert.equal(result.tasks.find((task) => task.TaskID === 'P001-ST1-6').ForecastEnd, '2026-11-16');
  assert.equal(scheduleSentence(delay.summary, result.affected, result.finish), 'Delayed "Drawing" by 3 days. 4 later tasks moved. Projected finish 16 Nov.');

  const redo = planTaskAction(rows, { taskId: 'P001-ST1-5', action: 'redo' }, { today: '2026-11-08' });
  assert.equal(redo.moves[0].end, '2026-11-16');
  assert.equal(redo.statusChange.ReworkCycle, '1');
  assert.equal(redo.statusChange.Status, 'In Progress');

  assert.throws(() => planTaskAction(rows, { taskId: 'P001-ST1-2', action: 'complete' }, { today: '2026-11-04' }), /Waiting for Civil — Site Condition Check/);
  const first = planTaskAction(rows, { taskId: 'P001-ST1-1', action: 'complete' }, { today: '2026-11-02' });
  assert.deepEqual(first.moves, []);
  assert.equal(first.statusChange.Status, 'Completed');
  const late = planTaskAction(rows, { taskId: 'P001-ST1-1', action: 'complete' }, { today: '2026-11-04' });
  assert.deepEqual(late.moves, [{ taskId: 'P001-ST1-1', start: '2026-11-02', end: '2026-11-04' }]);

  const done = rows.map((row) => (row.TaskID === 'P001-ST1-1' ? { ...row, Status: 'Completed' } : row));
  assert.throws(() => planTaskAction(done, { taskId: 'P001-ST1-1', action: 'delay', days: 2 }), /Add a new stage instead/);
  assert.throws(() => planTaskAction(rows, { taskId: 'P001-ST1-1', action: 'delay', days: 0 }), /1 to 60/);
  assert.throws(() => planTaskAction(rows, { taskId: 'nope', action: 'delay', days: 1 }), (error) => error.status === 404);
});

test('the shared stage template fixture matches the bot constant', async () => {
  const fixture = JSON.parse(await readFile(new URL('./stage-template.fixture.json', import.meta.url), 'utf8'));
  assert.deepEqual(fixture, STAGE_TASKS);
});
