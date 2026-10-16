// Graph scheduler for versioned workflows. Legacy sequential plans do not use this.
// Calendar-day math runs only when a duration is supplied. Unconfirmed durations stay unscheduled.
// Delay updates forecast dates for tasks that have not started. Planned and current dates stay as committed.

import { TRADE_ORDER, residentialInteriorDefinitions } from './residential-interior.js';

const DAY_MS = 24 * 60 * 60 * 1000;
// Delay statuses describe a request, not progress. Treating them as "started" froze delayed tasks in place.
const STARTED_STATUSES = new Set(['In Progress', 'Completed', 'Issue Reported', 'On hold']);
const EDGE_TYPES = new Set(['FS', 'SS']);

const parseDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  const date = new Date(`${value}T00:00:00Z`);
  // Reject impossible days such as 2026-02-30 instead of rolling them into the next month.
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
};
const formatDate = (date) => (date ? date.toISOString().slice(0, 10) : '');
const readableDate = (date) => date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const addDays = (date, days) => new Date(date.getTime() + days * DAY_MS);
const daySpan = (start, end) => Math.round((end.getTime() - start.getTime()) / DAY_MS);

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// Accepts 2026-09-20, "20 September", "Sep 20" or "20 Sep 2026". Ambiguous forms such as 5/1 or "tomorrow" are rejected.
export function parseUserDate(input, today = new Date()) {
  const text = String(input || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return parseDate(text) ? text : null;
  const match = text.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\.?,?(?:\s+(\d{4}))?$/i)
    || text.match(/^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?(?:\s+(\d{4}))?$/i);
  if (!match) return null;
  const [day, monthName] = /^\d/.test(match[1]) ? [match[1], match[2]] : [match[2], match[1]];
  const month = MONTHS.indexOf(monthName.slice(0, 3).toLowerCase());
  if (month < 0 || (monthName.length > 3 && !/^(january|february|march|april|may|june|july|august|september|october|november|december|sept)$/i.test(monthName))) return null;
  const build = (year) => `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (match[3]) return parseDate(build(match[3])) ? build(match[3]) : null;
  const thisYear = today.getUTCFullYear();
  const candidate = parseDate(build(thisYear));
  if (!candidate) return null;
  // Without a year, a date more than six months back almost always means next year.
  return candidate.getTime() < today.getTime() - 182 * DAY_MS && parseDate(build(thisYear + 1)) ? build(thisYear + 1) : build(thisYear);
}

// Legacy plans store only planned/current dates. Seeding the forecast from them lets one delay engine serve every plan.
export function withForecastDefaults(tasks) {
  return tasks.map((task) => ({
    ...task,
    ForecastStart: task.ForecastStart || task.CurrentStart || task.PlannedStart || '',
    ForecastEnd: task.ForecastEnd || task.CurrentEnd || task.PlannedEnd || '',
  }));
}

const CLOSED_STATUS = /^(Archived|Cancelled|Closed)/;

// Project finish from forecasts. Unconfirmed when any open task is undated.
export function projectedFinish(tasks) {
  const open = tasks.filter((task) => !CLOSED_STATUS.test(task.Status || ''));
  const ends = open.map((task) => parseDate(task.ForecastEnd || task.CurrentEnd || task.PlannedEnd));
  if (!ends.length || ends.some((end) => !end)) return '';
  return formatDate(ends.reduce((latest, date) => (date > latest ? date : latest)));
}

export function parseDependencyField(dependencySequences = '', predecessorTemplateId = '') {
  const raw = String(dependencySequences || '').trim();
  if (raw) {
    return raw.split(',').map((part) => part.trim()).filter(Boolean).map((part) => {
      const [sequence, type = 'FS'] = part.split(':');
      const edgeType = type.trim().toUpperCase() || 'FS';
      if (!EDGE_TYPES.has(edgeType)) throw new Error(`Unsupported dependency type "${type.trim()}" on sequence ${sequence.trim()}. Use FS or SS.`);
      return { sequence: sequence.trim(), type: edgeType };
    });
  }
  if (predecessorTemplateId) return [{ sequence: String(predecessorTemplateId).trim(), type: 'FS' }];
  return [];
}

export function isGraphTemplate(rows) {
  return rows.some((row) => row.DependencySequences || row.GateType || row.TemplateVersion);
}

export function sheetRowsToDefinitions(rows) {
  return rows.map((row) => ({
    workflowId: row.WorkflowID,
    sequence: String(row.Sequence),
    stage: row.Stage,
    taskName: row.TaskName,
    durationDays: row.DurationDays,
    defaultRole: row.DefaultRole,
    predecessors: parseDependencyField(row.DependencySequences, row.PredecessorTemplateID),
    required: row.Required,
    milestone: row.Milestone,
    gateType: row.GateType || '',
    audience: row.Audience || '',
    phase: row.Phase || '',
    trade: row.Trade || '',
    templateVersion: row.TemplateVersion || '',
    scheduleLink: row.ScheduleLink || scheduleLinkFor(row),
  }));
}

function scheduleLinkFor(row) {
  if (row.scheduleLink) return row.scheduleLink;
  const stage = row.Stage || row.stage;
  const name = row.TaskName || row.taskName || '';
  if (stage === 'Procurement' && /material presentation/i.test(name)) return 'procurement-start';
  if (stage === 'Procurement' && /on-site readiness/i.test(name)) return 'material-readiness';
  if (stage === 'Site Execution') return 'site-execution';
  if (stage === 'Design / Drawings') return 'design-drawings';
  return '';
}

function durationOf(definition, durationBySequence) {
  const override = durationBySequence?.[definition.sequence];
  const value = override === undefined ? definition.durationDays : override;
  if (value === '' || value === null || value === undefined) return null;
  const days = Number(value);
  return Number.isFinite(days) && days > 0 ? days : null;
}

export function scheduleDefinitions(definitions, { startDate, durationBySequence = {} } = {}) {
  const start = parseDate(startDate);
  if (!start) throw new Error('Start date must use YYYY-MM-DD.');
  const bySequence = new Map();
  for (const definition of definitions) {
    const sequence = String(definition.sequence);
    if (bySequence.has(sequence)) throw new Error(`Duplicate template sequence ${sequence}`);
    bySequence.set(sequence, definition);
  }
  const memo = new Map();

  function visit(sequence, stack) {
    if (memo.has(sequence)) return memo.get(sequence);
    if (stack.has(sequence)) throw new Error(`Dependency cycle at sequence ${sequence}`);
    const definition = bySequence.get(sequence);
    if (!definition) throw new Error(`Missing template sequence ${sequence}`);
    stack.add(sequence);
    const durationDays = durationOf(definition, durationBySequence);
    let earliest = start;
    let waitingOnDuration = false;
    for (const edge of definition.predecessors) {
      const predecessor = visit(String(edge.sequence), stack);
      const anchor = edge.type === 'SS' ? predecessor.forecastStart : (predecessor.forecastEnd ? addDays(predecessor.forecastEnd, 1) : null);
      if (!anchor) {
        waitingOnDuration = true;
        continue;
      }
      if (anchor > earliest) earliest = anchor;
    }
    stack.delete(sequence);
    const forecastStart = !waitingOnDuration && durationDays ? earliest : null;
    const forecastEnd = forecastStart ? addDays(forecastStart, durationDays - 1) : null;
    const result = {
      forecastStart,
      forecastEnd,
      unscheduledReason: forecastStart ? '' : (durationDays ? 'Waiting on a predecessor without a confirmed duration' : 'Duration unconfirmed'),
    };
    memo.set(sequence, result);
    return result;
  }

  const scheduled = definitions.map((definition) => {
    const dates = visit(String(definition.sequence), new Set());
    return { ...definition, ...dates };
  });
  const ends = scheduled.map((task) => task.forecastEnd).filter(Boolean);
  // A finish date is only meaningful when every task is dated. A partial plan stays unconfirmed.
  const targetEndDate = ends.length && ends.length === scheduled.length ? formatDate(ends.reduce((latest, date) => (date > latest ? date : latest))) : '';
  return { tasks: scheduled.map((task) => ({ ...task, forecastStart: formatDate(task.forecastStart), forecastEnd: formatDate(task.forecastEnd) })), targetEndDate };
}

export function buildScheduledTasks(sheetRows, { startDate, taskIdPrefix }) {
  const scheduled = scheduleDefinitions(sheetRowsToDefinitions(sheetRows), { startDate });
  const idFor = (sequence) => `${taskIdPrefix}-T${sequence}`;
  const tasks = scheduled.tasks.map((task) => {
    const edges = task.predecessors.map((edge) => `${idFor(edge.sequence)}:${edge.type}`);
    const firstFinish = task.predecessors.find((edge) => edge.type === 'FS');
    return {
      TaskID: idFor(task.sequence),
      WorkflowID: task.workflowId,
      TemplateID: `${task.workflowId}-${task.sequence}`,
      Sequence: task.sequence,
      Stage: task.stage,
      TaskName: task.taskName,
      AssignedRole: task.defaultRole,
      Status: 'Pending',
      PlannedStart: task.forecastStart,
      PlannedEnd: task.forecastEnd,
      CurrentStart: '',
      CurrentEnd: '',
      ApprovalStatus: task.gateType === 'approval' ? 'Not started' : 'Not Required',
      ReworkCycle: '0',
      PredecessorTaskID: firstFinish ? idFor(firstFinish.sequence) : '',
      PredecessorTaskIDs: edges.join(','),
      DependencyType: task.predecessors.length === 1 ? task.predecessors[0].type : '',
      ForecastStart: task.forecastStart,
      ForecastEnd: task.forecastEnd,
      ActualStart: '',
      ActualEnd: '',
      GateType: task.gateType,
      Audience: task.audience,
      Phase: task.phase,
      Trade: task.trade,
      TemplateVersion: task.templateVersion,
      BlockedReason: task.unscheduledReason,
    };
  });
  return { tasks, targetEndDate: scheduled.targetEndDate };
}

export function dependencyEdges(task) {
  const raw = String(task.PredecessorTaskIDs || '').trim();
  if (raw) {
    return raw.split(',').map((part) => part.trim()).filter(Boolean).map((part) => {
      const [id, type = 'FS'] = part.split(':');
      return { id: id.trim(), type: type.trim().toUpperCase() || 'FS' };
    });
  }
  if (task.PredecessorTaskID) return [{ id: task.PredecessorTaskID, type: 'FS' }];
  return [];
}

function isStarted(task) {
  return Boolean(task.ActualStart) || STARTED_STATUSES.has(task.Status);
}

export function completionBlockReason(task, projectTasks, revisions = []) {
  if (!task?.TemplateVersion && !task?.GateType && !task?.PredecessorTaskIDs) return '';
  if (task.Status === 'On hold' || task.ApprovalStatus === 'On hold') return 'This task is on hold';
  const byId = new Map(projectTasks.map((item) => [item.TaskID, item]));
  for (const edge of dependencyEdges(task)) {
    const predecessor = byId.get(edge.id);
    if (!predecessor) return `Missing predecessor ${edge.id}`;
    if (!EDGE_TYPES.has(edge.type)) return `Unsupported dependency type ${edge.type} on ${predecessor.TaskName}`;
    if (predecessor.Status === 'On hold' || predecessor.ApprovalStatus === 'On hold') return `${predecessor.TaskName} is on hold`;
    if (edge.type === 'FS' && predecessor.Status !== 'Completed') return `Waiting for ${predecessor.TaskName} to finish`;
    if (edge.type === 'SS' && !isStarted(predecessor) && predecessor.Status !== 'Completed') return `Waiting for ${predecessor.TaskName} to start`;
  }
  if (task.GateType === 'approval') {
    const approved = revisions.some((revision) => revision.TaskID === task.TaskID && revision.ApprovalState === 'Client approved');
    if (!approved) return 'Client approval of a drawing revision is required before this task can finish';
  }
  if (task.GateType === 'material' && task.Status !== 'Completed') return '';
  return '';
}

export function forecastDelayImpact(tasks, delayedTaskId, delayDays) {
  const days = Number(delayDays);
  if (!Number.isInteger(days) || days < 1) throw new Error('Delay days must be a positive integer.');
  const copies = tasks.map((task) => ({ ...task }));
  const byId = new Map(copies.map((task) => [task.TaskID, task]));
  const delayed = byId.get(delayedTaskId);
  if (!delayed) throw new Error(`Task ${delayedTaskId} was not found.`);
  const affected = [];

  const shiftForecast = (task, moveStart) => {
    const previousStart = task.ForecastStart;
    const previousEnd = task.ForecastEnd;
    if (parseDate(task.ForecastEnd)) task.ForecastEnd = formatDate(addDays(parseDate(task.ForecastEnd), days));
    if (moveStart && parseDate(task.ForecastStart)) task.ForecastStart = formatDate(addDays(parseDate(task.ForecastStart), days));
    return { previousStart, previousEnd };
  };

  if (!isStarted(delayed)) shiftForecast(delayed, true);
  else if (delayed.ForecastEnd) shiftForecast(delayed, false);
  affected.push({
    taskId: delayed.TaskID,
    taskName: delayed.TaskName,
    forecastStart: delayed.ForecastStart,
    forecastEnd: delayed.ForecastEnd,
    plannedStart: delayed.PlannedStart,
    plannedEnd: delayed.PlannedEnd,
    currentStart: delayed.CurrentStart,
    currentEnd: delayed.CurrentEnd,
    datesRewritten: false,
    note: 'Forecast moved. Planned and current dates were kept.',
  });

  const downstream = new Set();
  let grew = true;
  while (grew) {
    grew = false;
    for (const task of copies) {
      if (downstream.has(task.TaskID) || task.TaskID === delayed.TaskID) continue;
      if (dependencyEdges(task).some((edge) => edge.id === delayed.TaskID || downstream.has(edge.id))) {
        downstream.add(task.TaskID);
        grew = true;
      }
    }
  }

  // Recalculate predecessors before successors so results do not depend on sheet row order.
  const ordered = [];
  const placed = new Set();
  while (ordered.length < downstream.size) {
    const ready = [...downstream].filter((taskId) => !placed.has(taskId)
      && dependencyEdges(byId.get(taskId)).every((edge) => !downstream.has(edge.id) || placed.has(edge.id)));
    if (!ready.length) throw new Error('Dependency cycle among downstream tasks.');
    for (const taskId of ready) { placed.add(taskId); ordered.push(taskId); }
  }

  for (const taskId of ordered) {
    const task = byId.get(taskId);
    const previousStart = task.ForecastStart;
    const previousEnd = task.ForecastEnd;
    if (isStarted(task)) {
      affected.push({
        taskId: task.TaskID,
        taskName: task.TaskName,
        forecastStart: task.ForecastStart,
        forecastEnd: task.ForecastEnd,
        datesRewritten: false,
        note: 'Already started or committed. Forecast was not rewritten.',
      });
      continue;
    }
    const anchors = [];
    let missing = false;
    for (const edge of dependencyEdges(task)) {
      const predecessor = byId.get(edge.id);
      const forecastDate = edge.type === 'SS' ? predecessor?.ForecastStart : predecessor?.ForecastEnd;
      if (!parseDate(forecastDate)) {
        missing = true;
        break;
      }
      anchors.push(edge.type === 'SS' ? parseDate(forecastDate) : addDays(parseDate(forecastDate), 1));
    }
    if (missing || !anchors.length || !parseDate(previousStart) || !parseDate(previousEnd)) {
      affected.push({
        taskId: task.TaskID,
        taskName: task.TaskName,
        forecastStart: task.ForecastStart,
        forecastEnd: task.ForecastEnd,
        datesRewritten: false,
        note: 'Downstream of the delay. Forecast stays unset until durations are confirmed.',
      });
      continue;
    }
    // A delay only pushes work later. Keeping the current forecast as a floor preserves earlier delays.
    const nextStart = anchors.reduce((latest, date) => (date > latest ? date : latest), parseDate(previousStart));
    const span = daySpan(parseDate(previousStart), parseDate(previousEnd));
    task.ForecastStart = formatDate(nextStart);
    task.ForecastEnd = formatDate(addDays(nextStart, span));
    const changed = task.ForecastStart !== previousStart || task.ForecastEnd !== previousEnd;
    affected.push({
      taskId: task.TaskID,
      taskName: task.TaskName,
      forecastStart: task.ForecastStart,
      forecastEnd: task.ForecastEnd,
      datesRewritten: changed,
      note: changed ? 'Forecast updated. Planned and current dates were kept.' : 'Forecast unchanged.',
    });
  }

  return { tasks: copies, affected };
}

// Founder moves from the web timeline: drag, resize or swap. Each move sets a task's new start and end.
// Moved tasks must still respect their own predecessors. Successors are pushed later when needed, never pulled earlier.
export function rescheduleTasks(tasks, moves, { enforce = true } = {}) {
  const copies = withForecastDefaults(tasks);
  const byId = new Map(copies.map((task) => [task.TaskID, task]));
  const before = new Map(copies.map((task) => [task.TaskID, { start: task.ForecastStart, end: task.ForecastEnd }]));
  const conflicts = [];
  const movedIds = new Set();
  // forecastOnly moves (used by undo) restore a pushed successor without making it a committed plan change.
  const committedIds = new Set(moves.filter((move) => !move.forecastOnly).map((move) => move.taskId));
  for (const move of moves) {
    const task = byId.get(move.taskId);
    const start = parseDate(move.start);
    const end = parseDate(move.end);
    if (!task) { conflicts.push({ taskId: move.taskId, reason: 'Task not found.' }); continue; }
    if (!start || !end || end < start) { conflicts.push({ taskId: task.TaskID, taskName: task.TaskName, reason: 'Choose a start on or before the end.' }); continue; }
    if (enforce && (task.Status === 'Completed' || CLOSED_STATUS.test(task.Status || ''))) { conflicts.push({ taskId: task.TaskID, taskName: task.TaskName, reason: `${task.TaskName} is ${task.Status} and cannot be moved.` }); continue; }
    task.ForecastStart = formatDate(start);
    task.ForecastEnd = formatDate(end);
    movedIds.add(task.TaskID);
  }
  if (enforce) {
    for (const taskId of movedIds) {
      const task = byId.get(taskId);
      for (const edge of dependencyEdges(task)) {
        const predecessor = byId.get(edge.id);
        if (!predecessor || CLOSED_STATUS.test(predecessor.Status || '')) continue;
        const anchorDate = edge.type === 'SS' ? parseDate(predecessor.ForecastStart) : (parseDate(predecessor.ForecastEnd) && addDays(parseDate(predecessor.ForecastEnd), 1));
        if (anchorDate && parseDate(task.ForecastStart) < anchorDate) {
          conflicts.push({ taskId, taskName: task.TaskName, reason: `${task.TaskName} cannot start before ${readableDate(anchorDate)}: it waits for ${predecessor.TaskName} to ${edge.type === 'SS' ? 'start' : 'finish'}.` });
        }
      }
    }
  }
  const warnings = [];
  if (!conflicts.length) {
    const ordered = topologicalOrder(copies, byId);
    for (const taskId of ordered) {
      if (movedIds.has(taskId)) continue;
      const task = byId.get(taskId);
      const start = parseDate(task.ForecastStart);
      const end = parseDate(task.ForecastEnd);
      if (!start || !end) continue;
      const anchors = dependencyEdges(task).map((edge) => {
        const predecessor = byId.get(edge.id);
        if (!predecessor) return null;
        return edge.type === 'SS' ? parseDate(predecessor.ForecastStart) : (parseDate(predecessor.ForecastEnd) && addDays(parseDate(predecessor.ForecastEnd), 1));
      }).filter(Boolean);
      const earliest = anchors.reduce((latest, date) => (date > latest ? date : latest), start);
      if (earliest <= start) continue;
      if (isStarted(task)) {
        warnings.push({ taskId, taskName: task.TaskName, reason: `${task.TaskName} has already started, so it was not moved. It now overlaps work it depends on.` });
        continue;
      }
      const span = daySpan(start, end);
      task.ForecastStart = formatDate(earliest);
      task.ForecastEnd = formatDate(addDays(earliest, span));
    }
  }
  const affected = conflicts.length ? [] : copies.filter((task) => {
    const previous = before.get(task.TaskID);
    return previous.start !== task.ForecastStart || previous.end !== task.ForecastEnd;
  }).map((task) => ({
    taskId: task.TaskID,
    taskName: task.TaskName,
    moved: movedIds.has(task.TaskID),
    committed: committedIds.has(task.TaskID),
    previousStart: before.get(task.TaskID).start,
    previousEnd: before.get(task.TaskID).end,
    forecastStart: task.ForecastStart,
    forecastEnd: task.ForecastEnd,
  }));
  return { ok: !conflicts.length, conflicts, warnings, affected, tasks: copies, finish: conflicts.length ? '' : projectedFinish(copies) };
}

function topologicalOrder(tasks, byId) {
  const ordered = [];
  const state = new Map();
  const visit = (taskId) => {
    if (state.get(taskId) === 'done') return;
    if (state.get(taskId) === 'visiting') throw new Error(`Dependency cycle at ${taskId}`);
    state.set(taskId, 'visiting');
    for (const edge of dependencyEdges(byId.get(taskId))) if (byId.has(edge.id)) visit(edge.id);
    state.set(taskId, 'done');
    ordered.push(taskId);
  };
  for (const task of tasks) visit(task.TaskID);
  return ordered;
}

export function procurementRisks(tasks) {
  const risks = [];
  TRADE_ORDER.forEach((trade, index) => {
    if (index === 0) return;
    const previousTrade = TRADE_ORDER[index - 1];
    const tradeOf = (task) => task.Trade || task.trade;
    const stageOf = (task) => task.Stage || task.stage;
    const nameOf = (task) => task.TaskName || task.taskName || '';
    const readiness = tasks.find((task) => tradeOf(task) === trade && task.scheduleLink === 'material-readiness');
    const previousSite = tasks.find((task) => tradeOf(task) === previousTrade && task.scheduleLink === 'site-execution');
    const sheetReadiness = tasks.find((task) => tradeOf(task) === trade && stageOf(task) === 'Procurement' && /on-site readiness/i.test(nameOf(task)));
    const sheetSite = tasks.find((task) => tradeOf(task) === previousTrade && stageOf(task) === 'Site Execution');
    const readyEnd = parseDate((readiness || sheetReadiness)?.forecastEnd || (readiness || sheetReadiness)?.ForecastEnd);
    const siteEnd = parseDate((previousSite || sheetSite)?.forecastEnd || (previousSite || sheetSite)?.ForecastEnd);
    if (readyEnd && siteEnd && readyEnd > siteEnd) {
      risks.push({
        trade,
        previousTrade,
        message: `${trade} material readiness is forecast after ${previousTrade} site execution ends.`,
      });
    }
  });
  return risks;
}

function replaceCrossTradeProcurementEdges(definitions, tradeOrder) {
  const byTrade = (link, trade) => definitions.find((definition) => definition.trade === trade && (definition.scheduleLink === link || scheduleLinkFor(definition) === link));
  return definitions.map((definition) => {
    if (definition.scheduleLink !== 'procurement-start' && scheduleLinkFor(definition) !== 'procurement-start') return { ...definition, predecessors: definition.predecessors.map((edge) => ({ ...edge })) };
    const index = tradeOrder.indexOf(definition.trade);
    if (index < 0) return { ...definition, predecessors: definition.predecessors.map((edge) => ({ ...edge })) };
    if (index === 0) {
      const design = byTrade('design-drawings', definition.trade);
      return { ...definition, predecessors: [{ sequence: String(design.sequence), type: 'SS' }] };
    }
    const previousSite = byTrade('site-execution', tradeOrder[index - 1]);
    return { ...definition, predecessors: [{ sequence: String(previousSite.sequence), type: 'SS' }] };
  });
}

export function previewTradeOrderOverride(definitions, tradeOrder, { startDate, durationBySequence } = {}) {
  const original = definitions.map((definition) => ({ ...definition, predecessors: definition.predecessors.map((edge) => ({ ...edge })) }));
  const next = replaceCrossTradeProcurementEdges(original.map((definition) => ({ ...definition, predecessors: definition.predecessors.map((edge) => ({ ...edge })) })), tradeOrder);
  const before = scheduleDefinitions(original, { startDate, durationBySequence });
  const after = scheduleDefinitions(next, { startDate, durationBySequence });
  const beforeBySequence = new Map(before.tasks.map((task) => [String(task.sequence), task]));
  const changedEdges = next.filter((definition) => {
    const prior = original.find((item) => item.sequence === definition.sequence);
    return JSON.stringify(prior.predecessors) !== JSON.stringify(definition.predecessors);
  }).map((definition) => ({
    sequence: definition.sequence,
    taskName: definition.taskName,
    predecessors: definition.predecessors,
  }));
  const forecastDiffs = after.tasks.filter((task) => {
    const prior = beforeBySequence.get(String(task.sequence));
    return prior.forecastStart !== task.forecastStart || prior.forecastEnd !== task.forecastEnd;
  }).map((task) => ({
    sequence: task.sequence,
    taskName: task.taskName,
    forecastStart: task.forecastStart,
    forecastEnd: task.forecastEnd,
    previousForecastStart: beforeBySequence.get(String(task.sequence)).forecastStart,
    previousForecastEnd: beforeBySequence.get(String(task.sequence)).forecastEnd,
  }));
  const templateUntouched = JSON.stringify(original.map((definition) => definition.predecessors)) === JSON.stringify(definitions.map((definition) => definition.predecessors));
  return { definitions: next, changedEdges, forecastDiffs, templateUntouched };
}

export function defaultResidentialPreview(tradeOrder, options) {
  return previewTradeOrderOverride(residentialInteriorDefinitions(), tradeOrder, options);
}

export function audienceForRole(role = '') {
  const value = String(role).toLowerCase();
  if (/\bclient\b/.test(value)) return 'client';
  if (/\b(trade|worker|contractor)\b/.test(value)) return 'trade';
  if (/\b(admin|approver|designer|supervisor|design head|founder|site team|site supervisor)\b/.test(value)) return 'internal';
  return 'external';
}

export function resolveDrawing(revisions, role) {
  const audience = audienceForRole(role);
  const sorted = [...revisions].sort((left, right) => Number(left.Version ?? left.version) - Number(right.Version ?? right.version));
  const stateOf = (revision) => revision.ApprovalState || revision.approvalState;
  const refOf = (revision) => revision.StorageRef || revision.storageRef || '';
  if (audience === 'internal') {
    const latest = sorted.at(-1);
    if (!latest) return { status: 'No drawing uploaded', nextStep: 'Designer uploads a draft to this stage.', storageRef: null };
    return { status: stateOf(latest) || 'Draft', nextStep: '', storageRef: refOf(latest), revision: latest };
  }
  const approved = sorted.filter((revision) => stateOf(revision) === 'Client approved');
  const latestApproved = approved.at(-1);
  if (!latestApproved) {
    return {
      status: sorted.length ? 'Drawing under review' : 'No approved file',
      nextStep: sorted.length ? 'Wait for client approval. Drafts stay internal.' : 'No approved drawing is available yet.',
      storageRef: null,
    };
  }
  return { status: 'Approved', nextStep: '', storageRef: refOf(latestApproved), revision: latestApproved };
}

export function createDraftRevision({ revisionId, projectId, taskId, stage, version, fileName, storageRef, uploaderRole }) {
  return {
    RevisionID: revisionId,
    ProjectID: projectId,
    TaskID: taskId,
    Stage: stage,
    Version: String(version),
    FileName: fileName,
    StorageRef: storageRef,
    UploaderRole: uploaderRole,
    Audience: 'internal',
    ApprovalState: 'Draft',
    ParentRevisionID: '',
    UploadedAt: new Date().toISOString(),
  };
}

export function applyReviewDecision({ revision, stage, outcome, reviewerRole }) {
  if (!['admin', 'client'].includes(stage)) throw new Error('Review stage must be admin or client.');
  if (!['Approved', 'Rework needed', 'On hold'].includes(outcome)) throw new Error('Unsupported review outcome.');
  const approvalState = revision.ApprovalState || revision.approvalState;
  if (stage === 'client' && approvalState !== 'Admin approved') throw new Error('Client review starts only after admin approval.');
  if (stage === 'admin' && !['Draft', 'Rework needed'].includes(approvalState)) throw new Error('Admin review applies to a draft or a revision sent back for rework.');
  let nextState = approvalState;
  if (outcome === 'Rework needed') nextState = 'Rework needed';
  else if (outcome === 'On hold') nextState = 'On hold';
  else if (stage === 'admin') nextState = 'Admin approved';
  else nextState = 'Client approved';
  return {
    revision: {
      ...revision,
      ApprovalState: nextState,
      Audience: nextState === 'Client approved' ? 'approved-external' : 'internal',
    },
    assigneeUnchanged: true,
    designerNotification: outcome === 'Rework needed' ? 'unresolved' : '',
    blocksDependents: outcome === 'On hold',
    reviewerRole,
  };
}
