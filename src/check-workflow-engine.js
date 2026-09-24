import assert from 'node:assert/strict';
import { residentialInteriorDefinitions } from './residential-interior.js';
import {
  applyReviewDecision,
  buildScheduledTasks,
  createDraftRevision,
  forecastDelayImpact,
  isGraphTemplate,
  previewTradeOrderOverride,
  procurementRisks,
  resolveDrawing,
  scheduleDefinitions,
  completionBlockReason,
} from './workflow-engine.js';

const definitions = residentialInteriorDefinitions();
const originalEdges = JSON.stringify(definitions.map((definition) => definition.predecessors));
const durations = Object.fromEntries(definitions.map((definition) => [definition.sequence, 5]));
const scheduled = scheduleDefinitions(definitions, { startDate: '2026-01-05', durationBySequence: durations });
const byName = Object.fromEntries(scheduled.tasks.map((task) => [task.taskName, task]));

assert.equal(byName['Civil design and drawings'].forecastStart, byName['Electrical design and drawings'].forecastStart);
assert.equal(byName['Carpentry material presentation'].forecastStart, byName['Civil site execution'].forecastStart);
assert.ok(byName['Carpentry site execution'].forecastStart > byName['Civil site execution'].forecastStart);

const carpentrySite = definitions.find((definition) => definition.taskName === 'Carpentry site execution');
const civilSiteSequence = definitions.find((definition) => definition.taskName === 'Civil site execution').sequence;
assert.equal(carpentrySite.predecessors.some((edge) => edge.sequence === civilSiteSequence), false);
assert.equal(carpentrySite.predecessors.length, 3);

const rows = definitions.map((definition) => ({
  WorkflowID: definition.workflowId,
  Sequence: definition.sequence,
  Stage: definition.stage,
  TaskName: definition.taskName,
  DurationDays: '',
  DefaultRole: definition.defaultRole,
  PredecessorTemplateID: '',
  Required: definition.required,
  Milestone: definition.milestone,
  DependencySequences: definition.predecessors.map((edge) => `${edge.sequence}:${edge.type}`).join(','),
  GateType: definition.gateType,
  Audience: definition.audience,
  Phase: definition.phase,
  Trade: definition.trade,
  TemplateVersion: definition.templateVersion,
}));
assert.equal(isGraphTemplate(rows), true);
assert.equal(isGraphTemplate([{ WorkflowID: 'HOUSE-V1', PredecessorTemplateID: '5' }]), false);
const generated = buildScheduledTasks(rows, { startDate: '2026-01-05', taskIdPrefix: 'P1' });
assert.equal(generated.targetEndDate, '');
assert.ok(generated.tasks.every((task) => task.PlannedStart === '' && task.CurrentStart === ''));
const generatedSite = generated.tasks.find((task) => task.TaskName === 'Civil site execution');
assert.equal(generatedSite.PredecessorTaskIDs.split(',').length, 3);
assert.equal(completionBlockReason(generatedSite, generated.tasks, []), 'Waiting for Civil design and drawings to finish');

assert.ok(procurementRisks(scheduled.tasks).some((risk) => risk.trade === 'Carpentry'));

const preview = previewTradeOrderOverride(definitions, ['Civil', 'Electrical', 'Carpentry', 'Plumbing', 'Tiling'], {
  startDate: '2026-01-05',
  durationBySequence: durations,
});
assert.equal(preview.templateUntouched, true);
assert.equal(JSON.stringify(definitions.map((definition) => definition.predecessors)), originalEdges);
const electricalPresentation = preview.definitions.find((definition) => definition.taskName === 'Electrical material presentation');
assert.deepEqual(electricalPresentation.predecessors, [{ sequence: civilSiteSequence, type: 'SS' }]);
assert.ok(preview.changedEdges.length > 0);

const draft = createDraftRevision({
  revisionId: 'REV-1', projectId: 'P1', taskId: 'P1-T10', stage: 'Design / Drawings',
  version: 1, fileName: 'civil.pdf', storageRef: 'file-1', uploaderRole: 'Designer',
});
assert.equal(resolveDrawing([draft], 'Client').storageRef, null);
assert.equal(resolveDrawing([draft], 'Client').status, 'Drawing under review');
assert.equal(resolveDrawing([draft], 'Trade worker').storageRef, null);
assert.equal(resolveDrawing([draft], 'Designer').storageRef, 'file-1');
const adminApproved = applyReviewDecision({ revision: draft, stage: 'admin', outcome: 'Approved', reviewerRole: 'Project admin' });
assert.equal(resolveDrawing([adminApproved.revision], 'Client').storageRef, null);
assert.equal(resolveDrawing([adminApproved.revision], 'Client').status, 'Drawing under review');
const clientApproved = applyReviewDecision({ revision: adminApproved.revision, stage: 'client', outcome: 'Approved', reviewerRole: 'Client' });
assert.equal(resolveDrawing([clientApproved.revision], 'Client').storageRef, 'file-1');
assert.equal(resolveDrawing([clientApproved.revision], 'Trade worker').storageRef, 'file-1');
const rework = applyReviewDecision({ revision: draft, stage: 'admin', outcome: 'Rework needed', reviewerRole: 'Project admin' });
assert.equal(rework.assigneeUnchanged, true);
assert.equal(rework.designerNotification, 'unresolved');
assert.throws(() => applyReviewDecision({ revision: draft, stage: 'client', outcome: 'Approved', reviewerRole: 'Client' }), /admin approval/);
const held = applyReviewDecision({ revision: draft, stage: 'admin', outcome: 'On hold', reviewerRole: 'Project admin' });
assert.equal(held.blocksDependents, true);

const datedTasks = scheduled.tasks.map((task) => ({
  TaskID: `P1-T${task.sequence}`,
  TaskName: task.taskName,
  Status: 'Pending',
  Sequence: task.sequence,
  PlannedStart: task.forecastStart,
  PlannedEnd: task.forecastEnd,
  CurrentStart: task.forecastStart,
  CurrentEnd: task.forecastEnd,
  ForecastStart: task.forecastStart,
  ForecastEnd: task.forecastEnd,
  ActualStart: '',
  PredecessorTaskIDs: task.predecessors.map((edge) => `P1-T${edge.sequence}:${edge.type}`).join(','),
  TemplateVersion: 'RESIDENTIAL-INTERIOR-V1',
}));
const delayedId = datedTasks.find((task) => task.TaskName === 'Civil site execution').TaskID;
const impact = forecastDelayImpact(datedTasks, delayedId, 4);
const delayed = impact.tasks.find((task) => task.TaskID === delayedId);
const originalDelayed = datedTasks.find((task) => task.TaskID === delayedId);
assert.equal(delayed.PlannedStart, originalDelayed.PlannedStart);
assert.equal(delayed.PlannedEnd, originalDelayed.PlannedEnd);
assert.equal(delayed.CurrentStart, originalDelayed.CurrentStart);
assert.equal(delayed.CurrentEnd, originalDelayed.CurrentEnd);
assert.notEqual(delayed.ForecastStart, originalDelayed.ForecastStart);
const downstream = impact.affected.find((item) => item.taskName === 'Carpentry material presentation');
assert.equal(downstream.datesRewritten, true);
const started = datedTasks.map((task) => (task.TaskID === delayedId ? { ...task, Status: 'In Progress', ActualStart: task.ForecastStart } : task));
const startedImpact = forecastDelayImpact(started, delayedId, 4);
const startedTask = startedImpact.tasks.find((task) => task.TaskID === delayedId);
assert.equal(startedTask.ForecastStart, originalDelayed.ForecastStart);
assert.notEqual(startedTask.ForecastEnd, originalDelayed.ForecastEnd);
assert.equal(startedTask.CurrentEnd, originalDelayed.CurrentEnd);

const heldPredecessor = generated.tasks.find((task) => task.TaskName === 'Civil design and drawings');
heldPredecessor.Status = 'On hold';
assert.match(completionBlockReason(generatedSite, generated.tasks, []), /on hold/);

console.log(`Residential interior engine checks passed (${generated.tasks.length} template tasks).`);
