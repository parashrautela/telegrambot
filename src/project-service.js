import { buildScheduledTasks, isGraphTemplate } from './workflow-engine.js';

const dateText = (date) => date.toISOString().slice(0, 10);
const plusDays = (date, days) => new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
const taskId = (projectId, sequence) => `${projectId}-T${String(sequence / 10).padStart(3, '0')}`;

function validStartDate(startDateText) {
  const startDate = new Date(`${startDateText}T00:00:00Z`);
  if (Number.isNaN(startDate.getTime())) throw new Error('Start date must use YYYY-MM-DD.');
  return startDate;
}

export async function createProjectShell({ store, projectId, projectName, clientName, startDateText, groupChatId, leaderTelegramId = '' }) {
  if (!/^[A-Za-z0-9_-]+$/.test(projectId)) throw new Error('Project ID can contain only letters, numbers, hyphens, and underscores.');
  const startDate = validStartDate(startDateText);
  const projects = await store.rows('Projects');
  if (projects.some((project) => project.ProjectID === projectId)) throw new Error(`Project ${projectId} already exists.`);
  if (projects.some((project) => String(project.GroupChatID) === String(groupChatId))) throw new Error('That Telegram group is already linked to another project.');
  await store.append('Projects', {
    ProjectID: projectId,
    ProjectName: projectName,
    ClientName: clientName,
    Status: 'Awaiting client plan',
    LeaderTelegramID: String(leaderTelegramId),
    GroupChatID: String(groupChatId),
    StartDate: dateText(startDate),
    TargetEndDate: '',
    Notes: 'Waiting for a client to join and for the founder to assign a workflow.',
  });
  await store.audit({
    projectId, action: 'Project shell created', newValue: 'Awaiting client plan',
    actor: leaderTelegramId || 'System', actorName: 'Founder', source: 'Project generator', details: `Group ${groupChatId}`,
  });
  await store.markGroupLinked(groupChatId);
  return { status: 'Awaiting client plan' };
}

export async function assignWorkflowToProject({ store, project, workflowId, clientName = '', actorTelegramId = '', replaceUntouchedLegacyPlan = false }) {
  const existingTasks = await store.tasksForProject(project.ProjectID);
  if (existingTasks.length && !replaceUntouchedLegacyPlan) throw new Error('This project already has a workflow assigned.');
  if (replaceUntouchedLegacyPlan && existingTasks.some((task) => task.WorkflowID !== 'HOUSE-V1' || task.Status !== 'Pending')) {
    throw new Error('Only an untouched legacy house plan can be replaced.');
  }
  const workflow = (await store.rows('WorkflowTemplates'))
    .filter((row) => row.WorkflowID === workflowId)
    .sort((left, right) => Number(left.Sequence) - Number(right.Sequence));
  if (!workflow.length) throw new Error(`${workflowId} is missing from WorkflowTemplates.`);
  const startDate = validStartDate(project.StartDate);
  const graphTemplate = isGraphTemplate(workflow);
  const targetEndDate = graphTemplate
    ? ''
    : dateText(plusDays(startDate, workflow.reduce((total, template) => total + Number(template.DurationDays), 0) - 1));
  if (replaceUntouchedLegacyPlan) {
    for (const task of existingTasks) {
      await store.updateRow('Tasks', task.rowNumber, {
        Status: 'Archived — Superseded plan',
        ApprovalStatus: 'Closed',
        LastUpdatedAt: new Date().toISOString(),
        LastUpdatedBy: String(actorTelegramId || 'System'),
      });
    }
  }
  const taskIdPrefix = existingTasks.length ? `${project.ProjectID}-${workflowId.split('-')[0]}` : project.ProjectID;
  let scheduledTargetEnd = targetEndDate;
  if (graphTemplate) {
    const scheduled = buildScheduledTasks(workflow, { startDate: project.StartDate, taskIdPrefix });
    scheduledTargetEnd = scheduled.targetEndDate;
    for (const task of scheduled.tasks) {
      await store.append('Tasks', {
        ...task,
        ProjectID: project.ProjectID,
        LastUpdatedAt: new Date().toISOString(),
        LastUpdatedBy: String(actorTelegramId || 'System'),
      });
    }
  } else {
    let cursor = startDate;
    for (const template of workflow) {
      const duration = Number(template.DurationDays);
      const plannedStart = cursor;
      const plannedEnd = plusDays(plannedStart, duration - 1);
      const predecessor = template.PredecessorTemplateID ? taskId(taskIdPrefix, Number(template.PredecessorTemplateID)) : '';
      await store.append('Tasks', {
        TaskID: taskId(taskIdPrefix, Number(template.Sequence)), ProjectID: project.ProjectID,
        WorkflowID: template.WorkflowID, TemplateID: `${template.WorkflowID}-${template.Sequence}`,
        Sequence: template.Sequence, Stage: template.Stage, TaskName: template.TaskName,
        AssignedRole: template.DefaultRole, Status: 'Pending',
        PlannedStart: dateText(plannedStart), PlannedEnd: dateText(plannedEnd),
        CurrentStart: dateText(plannedStart), CurrentEnd: dateText(plannedEnd),
        ApprovalStatus: 'Not Required', ReworkCycle: '0', PredecessorTaskID: predecessor,
        LastUpdatedAt: new Date().toISOString(), LastUpdatedBy: String(actorTelegramId || 'System'),
      });
      cursor = plusDays(plannedEnd, 1);
    }
  }
  await store.updateRow('Projects', project.rowNumber, {
    ClientName: clientName || project.ClientName,
    Status: 'Active',
    TargetEndDate: scheduledTargetEnd,
    Notes: `Workflow ${workflowId} assigned after client onboarding${replaceUntouchedLegacyPlan ? '; untouched legacy HOUSE-V1 tasks archived.' : ''}`,
  });
  await store.audit({
    projectId: project.ProjectID, action: replaceUntouchedLegacyPlan ? 'Legacy workflow replaced' : 'Workflow assigned', newValue: `${workflowId}; ${workflow.length} tasks generated`,
    actor: actorTelegramId || 'System', actorName: 'Founder', source: 'Project generator', details: `Target end ${scheduledTargetEnd || 'unconfirmed durations'}${replaceUntouchedLegacyPlan ? `; ${existingTasks.length} legacy task(s) archived` : ''}`,
  });
  return {
    taskCount: workflow.length,
    targetEndDate: scheduledTargetEnd || 'Unconfirmed — template durations are not set',
    workflow,
  };
}

// Kept for the demo script and backwards compatibility. Founder-created
// production projects now use a shell and wait for client onboarding.
export async function createProjectFromHouseWorkflow(options) {
  await createProjectShell(options);
  const project = await options.store.projectById(options.projectId);
  return assignWorkflowToProject({
    store: options.store,
    project,
    workflowId: 'HOUSE-V1',
    clientName: options.clientName,
    actorTelegramId: options.leaderTelegramId,
  });
}
