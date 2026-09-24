// Graph scheduler for versioned workflows. Legacy sequential plans do not use this.
// Calendar-day math runs only when a duration is supplied. Unconfirmed durations stay unscheduled.
// Delay updates forecast dates for tasks that have not started. Planned and current dates stay as committed.

import { TRADE_ORDER, residentialInteriorDefinitions } from './residential-interior.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const STARTED_STATUSES = new Set(['In Progress', 'Completed', 'Delay Requested', 'Delayed — Approved', 'Issue Reported', 'On hold']);

const parseDate = (value) => {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
};
const formatDate = (date) => (date ? date.toISOString().slice(0, 10) : '');
const addDays = (date, days) => new Date(date.getTime() + days * DAY_MS);
const daySpan = (start, end) => Math.round((end.getTime() - start.getTime()) / DAY_MS);

export function parseDependencyField(dependencySequences = '', predecessorTemplateId = '') {
  const raw = String(dependencySequences || '').trim();
  if (raw) {
    return raw.split(',').filter(Boolean).map((part) => {
      const [sequence, type = 'FS'] = part.split(':');
      return { sequence: sequence.trim(), type: type.trim() || 'FS' };
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
  const bySequence = new Map(definitions.map((definition) => [String(definition.sequence), definition]));
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
  const targetEndDate = ends.length ? formatDate(ends.reduce((latest, date) => (date > latest ? date : latest))) : '';
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
    return raw.split(',').filter(Boolean).map((part) => {
      const [id, type = 'FS'] = part.split(':');
      return { id, type };
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
    if (task.ForecastEnd) task.ForecastEnd = formatDate(addDays(parseDate(task.ForecastEnd), days));
    if (moveStart && task.ForecastStart) task.ForecastStart = formatDate(addDays(parseDate(task.ForecastStart), days));
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

  for (const taskId of downstream) {
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
      if (!forecastDate) {
        missing = true;
        break;
      }
      anchors.push(edge.type === 'SS' ? parseDate(forecastDate) : addDays(parseDate(forecastDate), 1));
    }
    if (missing || !anchors.length || !previousStart || !previousEnd) {
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
    const nextStart = anchors.reduce((latest, date) => (date > latest ? date : latest));
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
