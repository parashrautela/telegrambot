import { createHash } from 'node:crypto';

const DAY = 86400000;
const fail = (message, status = 409) => {
  throw Object.assign(new Error(message), { status });
};
const active = (task) => !/^(Archived|Cancelled)/i.test(task.Status || '');
export const taskPlanFingerprint = (tasks) =>
  createHash('sha256')
    .update(JSON.stringify([...tasks].sort((a, b) => a.TaskID.localeCompare(b.TaskID))))
    .digest('hex');
const date = (value) => {
  const time = Date.parse(value);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value || '') ||
    !Number.isFinite(time) ||
    new Date(time).toISOString().slice(0, 10) !== value
  )
    fail('Every reordered task needs valid dates.');
  return time;
};
const edges = (row) =>
  String(row.PredecessorTaskIDs || row.PredecessorTaskID || '')
    .split(',')
    .filter(Boolean)
    .map((part) => {
      const [id, type = 'FS'] = part.trim().split(':');
      return { id, type };
    });

export function validateStageOrder(rows, input) {
  const tasks = rows.filter(active),
    before = new Map(tasks.map((row) => [row.TaskID, row]));
  if (input.fingerprint !== taskPlanFingerprint(tasks))
    fail('The Telegram plan changed. Preview the order again.');
  const stages = new Set(tasks.map((row) => row.Stage));
  if (
    !Array.isArray(input.stageOrder) ||
    new Set(input.stageOrder).size !== input.stageOrder.length ||
    input.stageOrder.length !== stages.size ||
    input.stageOrder.some((name) => !stages.has(name))
  )
    fail('Send every project stage exactly once.');
  if (
    !Array.isArray(input.tasks) ||
    input.tasks.length !== tasks.length ||
    new Set(input.tasks.map((task) => task.id)).size !== tasks.length
  )
    fail('Send every active project task exactly once.');
  const previousOrder = [
    ...new Set(
      [...tasks].sort((a, b) => Number(a.Sequence) - Number(b.Sequence)).map((row) => row.Stage),
    ),
  ];
  const plans = new Map(input.tasks.map((task) => [task.id, task]));
  for (const task of input.tasks) {
    const row = before.get(task.id);
    if (!row) fail('Task does not belong to this project.');
    if (
      (row.ActualStart ||
        /^(Completed|Done|In Progress|On hold|Issue Reported)$/i.test(row.Status || '')) &&
      input.stageOrder.indexOf(row.Stage) !== previousOrder.indexOf(row.Stage)
    )
      fail('Started or finished work cannot be reordered.');
    const start = row.ForecastStart || row.CurrentStart || row.PlannedStart;
    const end = row.ForecastEnd || row.CurrentEnd || row.PlannedEnd;
    if (
      date(task.end) < date(task.start) ||
      date(task.end) - date(task.start) !== date(end) - date(start)
    )
      fail('Reordering must preserve every task duration.');
    if (
      !Array.isArray(task.dependencies) ||
      task.dependencies.some(
        (edge) =>
          !['FS', 'SS'].includes(edge.type) ||
          (!plans.has(edge.id) &&
            !edges(row).some((old) => old.id === edge.id && old.type === edge.type)),
      )
    )
      fail('Invalid task dependencies.');
    const changed =
      task.start !== start ||
      task.end !== end ||
      JSON.stringify(task.dependencies) !== JSON.stringify(edges(row));
    if (
      changed &&
      (row.ActualStart ||
        /^(Completed|Done|In Progress|On hold|Issue Reported)$/i.test(row.Status || ''))
    )
      fail('Started or finished work cannot be changed.');
    for (const edge of task.dependencies) {
      const previous = plans.get(edge.id);
      if (
        previous &&
        date(task.start) <
          date(edge.type === 'SS' ? previous.start : previous.end) + (edge.type === 'SS' ? 0 : DAY)
      )
        fail('The reordered plan violates a task dependency.');
    }
  }
  const visited = new Set(),
    visiting = new Set();
  const visit = (id) => {
    if (visiting.has(id)) fail('Task dependencies cannot form a cycle.');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const edge of plans.get(id)?.dependencies || []) if (plans.has(edge.id)) visit(edge.id);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of plans.keys()) visit(id);
  return input.stageOrder
    .flatMap((stage) =>
      tasks
        .filter((row) => row.Stage === stage)
        .sort((a, b) => Number(a.Sequence) - Number(b.Sequence)),
    )
    .map((row, index) => {
      const planned = plans.get(row.TaskID);
      const locked =
        row.ActualStart ||
        /^(Completed|Done|In Progress|On hold|Issue Reported)$/i.test(row.Status || '');
      return {
        ...row,
        Sequence: String((index + 1) * 10),
        ForecastStart: locked ? row.ForecastStart : planned.start,
        ForecastEnd: locked ? row.ForecastEnd : planned.end,
        CurrentStart: locked ? row.CurrentStart : planned.start,
        CurrentEnd: locked ? row.CurrentEnd : planned.end,
        PredecessorTaskID: planned.dependencies.find((edge) => edge.type === 'FS')?.id || '',
        PredecessorTaskIDs: planned.dependencies.map((edge) => `${edge.id}:${edge.type}`).join(','),
        DependencyType: planned.dependencies[0]?.type || 'FS',
      };
    });
}

export function createStageOrderBridge({ store, founderTelegramId }) {
  const saving = new Set();
  return async (input) => {
    const key = String(input.groupChatId || '');
    if (saving.has(key)) fail('The project plan is being saved. Try again shortly.');
    saving.add(key);
    try {
      const project = await store.projectForGroup(key);
      if (!project || ['Completed', 'Abandoned'].includes(project.Status))
        fail('Active project not found.', 404);
      const rows = (await store.tasksForProject(project.ProjectID)).filter(active);
      const stageOrder = [
        ...new Set(
          [...rows].sort((a, b) => Number(a.Sequence) - Number(b.Sequence)).map((row) => row.Stage),
        ),
      ];
      if (input.mode === 'snapshot')
        return { tasks: rows, stageOrder, fingerprint: taskPlanFingerprint(rows) };
      if (input.mode !== 'apply') fail('Choose snapshot or apply.', 400);
      const planned = validateStageOrder(rows, input);
      await store.saveStageOrder(project, planned, founderTelegramId);
      return {
        tasks: planned,
        stageOrder: input.stageOrder,
        fingerprint: taskPlanFingerprint(planned),
      };
    } finally {
      saving.delete(key);
    }
  };
}
