// Founder-built plans: a project is a list of stages, and every stage is the same six tasks run one after another.
// The web app sends intent (add a stage, delay a task); this module turns it into Tasks rows and schedule moves.
// Dates are calendar days in UTC, end dates inclusive, matching workflow-engine.js.

import { completionBlockReason, dependencyEdges } from './workflow-engine.js';
import { interiorSheetStages } from './interior-sheet-plan.js';

export const STAGE_WORKFLOW_ID = 'WEB-STAGE';
const TEMPLATE_VERSION = 'WEB-STAGE-V1';
const DAY_MS = 24 * 60 * 60 * 1000;
const CLOSED = /^(Archived|Cancelled|Closed)/;

// The six tasks of every stage, in order. The web app keeps an identical copy (stage-template.fixture.json guards it).
export const STAGE_TASKS = [
  { key: 'site-check', title: 'Site Condition Check', role: 'Site Supervisor' },
  { key: 'drawing', title: 'Drawing', role: 'Designer' },
  { key: 'approval', title: 'Drawing approval', role: 'Design Head/ Admin' },
  { key: 'client', title: 'Client Presentation & approval', role: 'Client' },
  { key: 'execution', title: 'Site Execution', role: 'Site Team', roleEditable: true },
  { key: 'final-check', title: 'Final check', role: 'Design Head/ Admin' },
];

export class PlanError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const parseDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
};
const formatDate = (date) => (date ? date.toISOString().slice(0, 10) : '');
const addDays = (date, days) => new Date(date.getTime() + days * DAY_MS);
const shiftDate = (value, days) => formatDate(addDays(parseDate(value), days));
const spanDays = (start, end) => Math.round((parseDate(end) - parseDate(start)) / DAY_MS) + 1;
export const effectiveStart = (task) => task.ForecastStart || task.CurrentStart || task.PlannedStart || '';
export const effectiveEnd = (task) => task.ForecastEnd || task.CurrentEnd || task.PlannedEnd || '';
const bySequence = (a, b) => (Number(a.Sequence) || 0) - (Number(b.Sequence) || 0);
const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const shortTitle = (task) => String(task.TaskName || '').split(' — ').slice(-1)[0];
const label = (value) => new Date(`${value}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

function openRows(rows) {
  return rows.filter((row) => !CLOSED.test(row.Status || ''));
}

export function stagesOf(rows) {
  const stages = new Map();
  for (const row of openRows(rows)) {
    const name = String(row.Stage || '').trim();
    if (!name) continue;
    if (!stages.has(name)) stages.set(name, []);
    stages.get(name).push(row);
  }
  for (const list of stages.values()) list.sort(bySequence);
  return stages;
}

function findStage(rows, name) {
  for (const [stageName, list] of stagesOf(rows)) if (sameName(stageName, name)) return { name: stageName, rows: list };
  return null;
}

// The stage that finishes last. A new stage goes after it unless the founder says otherwise.
function tailStage(rows) {
  let tail = null;
  for (const [name, list] of stagesOf(rows)) {
    const end = list.map(effectiveEnd).filter(Boolean).sort().at(-1) || '';
    if (!tail || end > tail.end || (end === tail.end && Math.max(...list.map((row) => Number(row.Sequence) || 0)) > tail.sequence)) {
      tail = { name, rows: list, end, sequence: Math.max(...list.map((row) => Number(row.Sequence) || 0)) };
    }
  }
  return tail;
}

function lastTaskOf(list) {
  const dated = list.filter((row) => effectiveEnd(row));
  if (dated.length) return dated.reduce((latest, row) => (effectiveEnd(row) > effectiveEnd(latest) || (effectiveEnd(row) === effectiveEnd(latest) && bySequence(row, latest) > 0) ? row : latest));
  return list.at(-1);
}

function validName(name) {
  const value = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
  if (!value || value.length > 60) throw new PlanError('Enter a stage name of 1 to 60 characters.');
  // Task names are "Stage — Task", so the separator cannot appear in a stage name.
  if (value.includes('—')) throw new PlanError('Stage names cannot contain "—".');
  return value;
}

function validDuration(value) {
  if (value === null || value === undefined || value === '') return 0;
  const days = Number(value);
  if (!Number.isInteger(days) || days < 0 || days > 365) throw new PlanError('Durations must be whole days from 0 (skip) to 365.');
  return days;
}

function assigneeFor(task, role, groupMembers) {
  if (task.assigneeTelegramId) {
    if (!/^\d+$/.test(String(task.assigneeTelegramId))) throw new PlanError('Invalid task assignee.');
    return { id: String(task.assigneeTelegramId), name: String(task.assigneeName || '').slice(0, 100) };
  }
  const matches = groupMembers.filter((member) => member.MembershipStatus === 'Active' && sameName(member.AssignedRole, role));
  return matches.length === 1 ? { id: String(matches[0].TelegramUserID), name: matches[0].AssignedName || matches[0].TelegramName || '' } : { id: '', name: '' };
}

function nextStageNumber(rows, projectId) {
  const used = new Set(rows.map((row) => String(row.TaskID || '').match(new RegExp(`^${projectId}-ST(\\d+)-`))?.[1]).filter(Boolean).map(Number));
  let number = 1;
  while (used.has(number)) number += 1;
  return number;
}

function baseRow(fields) {
  return {
    WorkflowID: STAGE_WORKFLOW_ID,
    Status: 'Pending',
    CurrentStart: '',
    CurrentEnd: '',
    ApprovalStatus: 'Not Required',
    ReworkCycle: '0',
    ActualStart: '',
    ActualEnd: '',
    GateType: '',
    Phase: 'Site',
    TemplateVersion: TEMPLATE_VERSION,
    ...fields,
  };
}

// Builds the Tasks rows for one new stage. Nothing is written here.
// spec: { name, placement: { type: 'after'|'parallel'|'date', stageName?, startDate? }, doneCount?, tasks: [{ key, durationDays, role?, assigneeTelegramId?, assigneeName? }] }
export function buildStageTasks(existingRows, spec, { projectId, groupMembers = [], today = formatDate(new Date()), lastUpdatedBy = '' } = {}) {
  if (!spec || typeof spec !== 'object') throw new PlanError('Send a stage.');
  if (!projectId) throw new PlanError('Project not found.', 404);
  const name = validName(spec.name);
  const clash = findStage(existingRows, name);
  if (clash) throw new PlanError(`A stage called "${clash.name}" already exists. Try "${clash.name} (2)".`, 409);

  const input = Array.isArray(spec.tasks) ? spec.tasks : [];
  const custom = spec.custom === true;
  if (input.length > (custom ? 60 : STAGE_TASKS.length)) throw new PlanError(custom ? 'A custom stage has at most 60 tasks.' : 'A stage has at most six tasks.');
  const byKey = new Map();
  for (const task of input) {
    if (!task || (!custom && !STAGE_TASKS.some((item) => item.key === task.key))) throw new PlanError('Unknown stage task.');
    if (custom && (typeof task.key !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(task.key))) throw new PlanError('Invalid custom task key.');
    if (byKey.has(task.key)) throw new PlanError('Each stage task can appear once.');
    byKey.set(task.key, task);
  }
  const templates = custom ? input.map((task) => {
    const title = typeof task.title === 'string' ? task.title.trim() : '';
    if (!title || title.length > 80 || title.includes('—')) throw new PlanError('Enter a task title of 1 to 80 characters without "—".');
    if (typeof task.role !== 'string' || !task.role.trim() || task.role.trim().length > 80) throw new PlanError('Enter a task role of 1 to 80 characters.');
    if (!validDuration(task.durationDays)) throw new PlanError('Custom tasks need at least one day.');
    return { key: task.key, title, role: task.role.trim(), roleEditable: true };
  }) : STAGE_TASKS;
  const chosen = templates.map((template, index) => {
    const task = byKey.get(template.key) || {};
    const role = template.roleEditable && typeof task.role === 'string' && task.role.trim() ? task.role.trim().slice(0, 80) : template.role;
    return { template, index, task, role, durationDays: validDuration(task.durationDays) };
  }).filter((item) => item.durationDays > 0);
  if (!chosen.length) throw new PlanError('Give at least one task a duration.');
  const doneCount = spec.doneCount === undefined || spec.doneCount === null ? 0 : Number(spec.doneCount);
  if (!Number.isInteger(doneCount) || doneCount < 0 || doneCount > chosen.length) throw new PlanError('Tasks already done must be between 0 and the number of tasks.');

  // Where the stage starts: after another stage, alongside one, or on a date.
  const placement = spec.placement || {};
  const warnings = [];
  let anchorEdge = '';
  let start = null;
  const tail = tailStage(existingRows);
  const type = placement.type || (tail ? 'after' : 'date');
  if (type === 'after' || type === 'parallel') {
    const stage = placement.stageName ? findStage(existingRows, placement.stageName) : tail && { name: tail.name, rows: tail.rows };
    if (!stage) throw new PlanError(`Stage "${placement.stageName}" was not found.`, 404);
    const anchor = type === 'after' ? lastTaskOf(stage.rows) : stage.rows[0];
    anchorEdge = `${anchor.TaskID}:${type === 'after' ? 'FS' : 'SS'}`;
    const date = type === 'after' ? effectiveEnd(anchor) : effectiveStart(anchor);
    start = date ? (type === 'after' ? addDays(parseDate(date), 1) : parseDate(date)) : null;
    if (!start) warnings.push({ reason: `${stage.name} has no dates yet, so ${name} stays unscheduled until it does.` });
  } else if (type === 'date') {
    start = parseDate(placement.startDate || today);
    if (!start) throw new PlanError('Choose a real start date.');
  } else {
    throw new PlanError('Choose where the stage starts.');
  }

  const number = nextStageNumber(existingRows, projectId);
  let sequence = Math.max(0, ...existingRows.map((row) => Number(row.Sequence) || 0));
  let cursor = start;
  let previousId = '';
  const stamp = new Date().toISOString();
  const rows = chosen.map((item, position) => {
    const taskId = `${projectId}-ST${number}-${item.index + 1}`;
    const taskStart = cursor ? formatDate(cursor) : '';
    const taskEnd = cursor ? formatDate(addDays(cursor, item.durationDays - 1)) : '';
    if (cursor) cursor = addDays(cursor, item.durationDays);
    const predecessor = position === 0 ? anchorEdge : `${previousId}:FS`;
    previousId = taskId;
    const done = position < doneCount;
    const assignee = assigneeFor(item.task, item.role, groupMembers);
    sequence += 10;
    return baseRow({
      TaskID: taskId,
      ProjectID: projectId,
      TemplateID: `${STAGE_WORKFLOW_ID}-${number}-${item.template.key}`,
      Sequence: String(sequence),
      Stage: name,
      TaskName: `${name} — ${item.template.title}`,
      AssignedTelegramID: assignee.id,
      AssignedName: assignee.name,
      AssignedRole: item.role,
      Status: done ? 'Completed' : 'Pending',
      PlannedStart: taskStart,
      PlannedEnd: taskEnd,
      ForecastStart: taskStart,
      ForecastEnd: taskEnd,
      ActualStart: done ? taskStart : '',
      ActualEnd: done ? taskEnd : '',
      PredecessorTaskID: predecessor.endsWith(':FS') ? predecessor.split(':')[0] : '',
      PredecessorTaskIDs: predecessor,
      DependencyType: predecessor ? predecessor.split(':')[1] : '',
      Audience: item.role === 'Client' ? 'client' : 'internal',
      Trade: name,
      BlockedReason: taskStart ? '' : 'Waiting on a predecessor without a confirmed duration',
      LastUpdatedAt: stamp,
      LastUpdatedBy: String(lastUpdatedBy),
    });
  });
  return {
    rows,
    stage: { name, startDate: rows[0].PlannedStart, endDate: rows.at(-1).PlannedEnd },
    warnings,
  };
}

// Several stages in order, each able to refer to the ones before it.
export function buildStagePlan(existingRows, specs, options) {
  if (!Array.isArray(specs) || !specs.length || specs.length > 40) throw new PlanError('Send between 1 and 40 stages.');
  let rows = [...existingRows];
  const created = [];
  const stages = [];
  const warnings = [];
  for (const spec of specs) {
    const result = buildStageTasks(rows, spec, options);
    rows = rows.concat(result.rows);
    created.push(...result.rows);
    stages.push(result.stage);
    warnings.push(...result.warnings);
  }
  return { rows: created, stages, warnings };
}

// One extra task inside a stage, placed after another task of that stage (or first when afterTaskId is blank).
// Returns the new row plus the predecessor rewiring, so the chain stays one after another.
export function insertStageTask(existingRows, { stageName, afterTaskId = '', title, role, durationDays, assigneeTelegramId, assigneeName }, { projectId, groupMembers = [], lastUpdatedBy = '' } = {}) {
  const stage = findStage(existingRows, stageName);
  if (!stage) throw new PlanError(`Stage "${stageName}" was not found.`, 404);
  const name = typeof title === 'string' ? title.trim().replace(/\s+/g, ' ') : '';
  if (!name || name.length > 80) throw new PlanError('Enter a task title of 1 to 80 characters.');
  const days = validDuration(durationDays);
  if (!days) throw new PlanError('Give the task at least one day.');
  const taskRole = typeof role === 'string' && role.trim() ? role.trim().slice(0, 80) : 'Site Team';
  const after = afterTaskId ? stage.rows.find((row) => row.TaskID === afterTaskId) : null;
  if (afterTaskId && !after) throw new PlanError('That task is not in this stage.', 404);
  const first = stage.rows[0];
  const taskId = (() => {
    let number = 1;
    while (existingRows.some((row) => row.TaskID === `${projectId}-ADD${number}`)) number += 1;
    return `${projectId}-ADD${number}`;
  })();

  // The new task takes over the old links: it waits for "after" (or for whatever the first task waited for).
  const predecessors = after ? `${after.TaskID}:FS` : String(first.PredecessorTaskIDs || '');
  const startDate = after ? (effectiveEnd(after) ? shiftDate(effectiveEnd(after), 1) : '') : effectiveStart(first);
  const endDate = startDate ? shiftDate(startDate, days - 1) : '';
  const rewire = [];
  const replaceLink = (row, fromId) => {
    const edges = dependencyEdges(row).map((edge) => (edge.id === fromId && edge.type === 'FS' ? { ...edge, id: taskId } : edge));
    return edges.map((edge) => `${edge.id}:${edge.type}`).join(',');
  };
  if (after) {
    const wasLast = lastTaskOf(stage.rows).TaskID === after.TaskID;
    for (const row of openRows(existingRows)) {
      if (row.TaskID === after.TaskID) continue;
      const pointsAtAfter = dependencyEdges(row).some((edge) => edge.id === after.TaskID && edge.type === 'FS');
      if (!pointsAtAfter) continue;
      // Same-stage successors always move behind the new task; other stages only when it becomes the stage's last task.
      if (sameName(row.Stage, stage.name) || wasLast) rewire.push({ row, PredecessorTaskIDs: replaceLink(row, after.TaskID) });
    }
  } else {
    rewire.push({ row: first, PredecessorTaskIDs: `${taskId}:FS` });
  }

  const sequences = stage.rows.map((row) => Number(row.Sequence) || 0);
  const lower = after ? Number(after.Sequence) || 0 : Math.min(...sequences) - 10;
  const higher = sequences.filter((value) => value > lower).sort((a, b) => a - b)[0];
  const sequence = higher === undefined ? lower + 10 : higher - lower > 1 ? Math.floor((lower + higher) / 2) : (lower + higher) / 2;
  const assignee = assigneeFor({ assigneeTelegramId, assigneeName }, taskRole, groupMembers);
  const row = baseRow({
    TaskID: taskId,
    ProjectID: projectId,
    TemplateID: `${STAGE_WORKFLOW_ID}-ADD`,
    Sequence: String(sequence),
    Stage: stage.name,
    TaskName: `${stage.name} — ${name}`,
    AssignedTelegramID: assignee.id,
    AssignedName: assignee.name,
    AssignedRole: taskRole,
    PlannedStart: startDate,
    PlannedEnd: endDate,
    ForecastStart: startDate,
    ForecastEnd: endDate,
    PredecessorTaskID: predecessors.split(',').find((edge) => edge.endsWith(':FS'))?.split(':')[0] || '',
    PredecessorTaskIDs: predecessors,
    DependencyType: predecessors && !predecessors.includes(',') ? predecessors.split(':')[1] : '',
    Audience: taskRole === 'Client' ? 'client' : 'internal',
    Trade: stage.name,
    BlockedReason: startDate ? '' : 'Waiting on a predecessor without a confirmed duration',
    LastUpdatedAt: new Date().toISOString(),
    LastUpdatedBy: String(lastUpdatedBy),
  });
  return { row, rewire: rewire.map(({ row: target, PredecessorTaskIDs }) => ({ taskId: target.TaskID, rowNumber: target.rowNumber, PredecessorTaskIDs, PredecessorTaskID: PredecessorTaskIDs.split(',').find((edge) => edge.endsWith(':FS'))?.split(':')[0] || '' })) };
}

// Delay / redo / complete for one task. Returns schedule moves for rescheduleTasks and the status fields to write after them.
export function planTaskAction(rows, { taskId, action, days }, { today = formatDate(new Date()) } = {}) {
  const row = rows.find((item) => item.TaskID === taskId);
  if (!row) throw new PlanError('Task not found in this project.', 404);
  const start = effectiveStart(row);
  const end = effectiveEnd(row);
  const done = row.Status === 'Completed' || CLOSED.test(row.Status || '');
  const title = shortTitle(row);
  if (action === 'delay' || action === 'redo') {
    if (done) throw new PlanError(`${title} is already completed. Add a new stage instead.`, 409);
    if (!start || !end) throw new PlanError(`${title} has no dates yet.`, 409);
  }
  if (action === 'delay') {
    const count = Number(days);
    if (!Number.isInteger(count) || count < 1 || count > 60) throw new PlanError('Delay by 1 to 60 days.');
    return { row, moves: [{ taskId, start, end: shiftDate(end, count) }], statusChange: {}, added: count, summary: `Delayed "${title}" by ${count} day${count === 1 ? '' : 's'}.` };
  }
  if (action === 'redo') {
    const length = row.PlannedStart && row.PlannedEnd ? spanDays(row.PlannedStart, row.PlannedEnd) : spanDays(start, end);
    const started = Boolean(row.ActualStart) || ['In Progress', 'Issue Reported'].includes(row.Status) || start <= today;
    return {
      row,
      moves: [{ taskId, start, end: shiftDate(end, length) }],
      statusChange: { ReworkCycle: String((Number(row.ReworkCycle) || 0) + 1), ...(started ? { Status: 'In Progress' } : {}) },
      added: length,
      summary: `Sent "${title}" back for rework (+${length} day${length === 1 ? '' : 's'}).`,
    };
  }
  if (action === 'complete') {
    if (row.Status === 'Completed') throw new PlanError(`${title} is already completed.`, 409);
    if (CLOSED.test(row.Status || '')) throw new PlanError(`${title} is closed.`, 409);
    const blocked = completionBlockReason(row, rows);
    if (blocked) throw new PlanError(`${title} cannot be completed yet: ${blocked}.`, 409);
    // Late work ends today and pushes what waits on it. Early work keeps the calendar as planned.
    const moves = start && end && today > end ? [{ taskId, start, end: today }] : [];
    return {
      row,
      moves,
      statusChange: { Status: 'Completed', ActualStart: row.ActualStart || (start && start < today ? start : today), ActualEnd: today },
      added: 0,
      summary: `Marked "${title}" complete.`,
    };
  }
  throw new PlanError('Choose delay, redo or complete.');
}

export function scheduleSentence(summary, affected = [], finish = '') {
  const pushed = affected.filter((item) => !item.moved).length;
  return [summary, pushed ? `${pushed} later task${pushed === 1 ? '' : 's'} moved.` : '', finish ? `Projected finish ${label(finish)}.` : ''].filter(Boolean).join(' ');
}

// The founders' INTERIOR 1 plan in six-slot stages, for the "start from the default plan" option.
const DEFAULT_SLOTS = [
  ['site-check', ['Existing resources', 'Site Condition Check', 'Site Check']],
  ['drawing', ['2D drawing', '3D Design', 'Drawing', 'Presentation', 'Drawings & Presentation']],
  ['approval', ['Design approval', 'Drawing approval', 'Drawing approval & Electrician Final', 'Approval']],
  ['client', ['Client Presentation & approval', 'Selection and site delivery', 'Purchase / Vendor final']],
  ['execution', ['Site Execution', 'Ceiling channelling', 'Wall POP']],
  ['final-check', ['Final check']],
];
const slotFor = (title) => DEFAULT_SLOTS.find(([, titles]) => titles.some((item) => sameName(item, title)))?.[0] || '';

export function defaultPlanStages(sheetStages = interiorSheetStages()) {
  const counts = new Map();
  for (const stage of sheetStages) counts.set(stage.name, (counts.get(stage.name) || 0) + 1);
  // A trade with a parallel prep lane and a main lane shares one name in the sheet; the prep lane gets "(prep)".
  const nameFor = (stage) => (counts.get(stage.name) > 1 && stage.lane === 'parallel' ? `${stage.name} (prep)` : stage.name).replace(/_/g, ' ');
  const byCode = new Map(sheetStages.map((stage) => [stage.code, stage]));
  let previousMain = '';
  return sheetStages.map((stage) => {
    const durations = new Map();
    const roles = new Map();
    for (const [, , title, days, role] of stage.tasks) {
      const slot = slotFor(title);
      if (!slot) continue;
      durations.set(slot, (durations.get(slot) || 0) + (days || 1));
      if (!roles.has(slot) && role) roles.set(slot, role);
    }
    const name = nameFor(stage);
    const placement = stage.lane === 'parallel'
      ? { type: 'parallel', stageName: nameFor(byCode.get(stage.anchor.stageCode)) }
      : previousMain ? { type: 'after', stageName: previousMain } : { type: 'date' };
    if (stage.lane === 'main') previousMain = name;
    return {
      name,
      placement,
      tasks: STAGE_TASKS.map((template) => ({
        key: template.key,
        durationDays: durations.get(template.key) || 0,
        ...(template.roleEditable && roles.get('execution') ? { role: roles.get('execution') } : {}),
      })),
    };
  });
}
