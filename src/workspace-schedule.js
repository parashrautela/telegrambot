// Date-only calendar-day scheduling. Baselines and actuals never change here.
const day = 86400000;
export const validDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
export function shiftDate(value, days) {
  if (!validDate(value) || !Number.isInteger(days)) throw new Error('Use a valid calendar date and whole days.');
  return new Date(Date.parse(`${value}T00:00:00Z`) + days * day).toISOString().slice(0, 10);
}
export function calculateSchedule(tasks, edges, startDate) {
  if (!validDate(startDate)) throw new Error('Start date must be a valid YYYY-MM-DD date.');
  const byId = new Map(tasks.map(t => [t.id, t]));
  const memo = new Map(); const visiting = new Set();
  for (const e of edges) {
    if (!byId.has(e.predecessorId) || !byId.has(e.taskId)) throw new Error('Dependency task is missing.');
    if (!['FS', 'SS'].includes(e.type)) throw new Error('Use FS or SS dependencies.');
  }
  function visit(taskId) {
    if (memo.has(taskId)) return memo.get(taskId);
    if (visiting.has(taskId)) throw new Error('Dependencies cannot contain a cycle.');
    visiting.add(taskId);
    const t = byId.get(taskId); const predecessors = edges.filter(e => e.taskId === taskId);
    let start = t.notBefore || startDate; let missing = '';
    const blockers = [];
    for (const e of predecessors) {
      const p = visit(e.predecessorId); const original = byId.get(e.predecessorId);
      const anchor = e.type === 'SS' ? original.actualStart || p.forecastStart : original.actualEnd || p.forecastEnd;
      if (!anchor) missing = 'Waiting for an unconfirmed predecessor date';
      else start = [start, shiftDate(anchor, e.type === 'FS' ? 1 : 0)].sort().at(-1);
      if (e.type === 'FS' ? original.status !== 'Resolved' : !original.actualStart && original.status !== 'Resolved') blockers.push(original.title);
    }
    if (!t.actualStart && t.delayDays) start = shiftDate(start, t.delayDays);
    if (!Number.isInteger(t.durationDays) || t.durationDays < 1) missing = 'Duration not confirmed';
    const result = { id: taskId, forecastStart: missing ? '' : start, forecastEnd: missing ? '' : shiftDate(start, t.durationDays - 1), unscheduledReason: missing, dependencyBlocker: blockers.length ? `Waiting for ${blockers.join(', ')}` : '' };
    if (t.actualStart) {
      result.forecastStart = t.actualStart;
      result.forecastEnd = t.actualEnd || (t.durationDays ? shiftDate(t.actualStart, t.durationDays - 1 + (t.delayDays || 0)) : '');
      if (start > t.actualStart && blockers.length) result.dependencyBlocker = `Started work needs review: ${blockers.join(', ')}`;
    }
    if (t.status === 'Resolved') { result.forecastStart = t.actualStart || t.forecastStart; result.forecastEnd = t.actualEnd || t.forecastEnd; }
    if (t.status === 'Cancelled') { result.forecastStart = ''; result.forecastEnd = ''; result.unscheduledReason = 'Cancelled predecessor needs review'; }
    visiting.delete(taskId); memo.set(taskId, result); return result;
  }
  return tasks.map(t => visit(t.id));
}
