const dateText = (date) => date.toISOString().slice(0, 10);
const plusDays = (date, days) => new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
const taskId = (projectId, sequence) => `${projectId}-T${String(sequence / 10).padStart(3, '0')}`;

export async function createProjectFromHouseWorkflow({ store, projectId, projectName, clientName, startDateText, groupChatId, leaderTelegramId = '' }) {
  if (!/^[A-Za-z0-9_-]+$/.test(projectId)) throw new Error('Project ID can contain only letters, numbers, hyphens, and underscores.');
  const startDate = new Date(`${startDateText}T00:00:00Z`);
  if (Number.isNaN(startDate.getTime())) throw new Error('Start date must use YYYY-MM-DD.');
  const projects = await store.rows('Projects');
  if (projects.some((project) => project.ProjectID === projectId)) throw new Error(`Project ${projectId} already exists.`);
  if (projects.some((project) => String(project.GroupChatID) === String(groupChatId))) throw new Error('That Telegram group is already linked to another project.');

  const workflow = (await store.rows('WorkflowTemplates'))
    .filter((row) => row.WorkflowID === 'HOUSE-V1')
    .sort((left, right) => Number(left.Sequence) - Number(right.Sequence));
  if (!workflow.length) throw new Error('HOUSE-V1 is missing. Run the workflow seed command first.');

  const targetEndDate = dateText(plusDays(startDate, workflow.reduce((total, template) => total + Number(template.DurationDays), 0) - 1));
  let cursor = startDate;
  await store.append('Projects', {
    ProjectID: projectId,
    ProjectName: projectName,
    ClientName: clientName,
    Status: 'Active',
    LeaderTelegramID: String(leaderTelegramId),
    GroupChatID: String(groupChatId),
    StartDate: dateText(startDate),
    TargetEndDate: targetEndDate,
    Notes: 'Pilot project generated from HOUSE-V1.',
  });
  for (const template of workflow) {
    const duration = Number(template.DurationDays);
    const plannedStart = cursor;
    const plannedEnd = plusDays(plannedStart, duration - 1);
    const predecessor = template.PredecessorTemplateID ? taskId(projectId, Number(template.PredecessorTemplateID)) : '';
    await store.append('Tasks', {
      TaskID: taskId(projectId, Number(template.Sequence)), ProjectID: projectId,
      WorkflowID: template.WorkflowID, TemplateID: `${template.WorkflowID}-${template.Sequence}`,
      Sequence: template.Sequence, Stage: template.Stage, TaskName: template.TaskName,
      AssignedRole: template.DefaultRole, Status: 'Pending',
      PlannedStart: dateText(plannedStart), PlannedEnd: dateText(plannedEnd),
      CurrentStart: dateText(plannedStart), CurrentEnd: dateText(plannedEnd),
      ApprovalStatus: 'Not Required', ReworkCycle: '0', PredecessorTaskID: predecessor,
      LastUpdatedAt: new Date().toISOString(), LastUpdatedBy: 'System',
    });
    cursor = plusDays(plannedEnd, 1);
  }
  await store.audit({
    projectId, action: 'Pilot project created', newValue: `${workflow.length} tasks generated`,
    actor: leaderTelegramId || 'System', actorName: 'Founder', source: 'Project generator',
    details: `Workflow HOUSE-V1; group ${groupChatId}`,
  });
  await store.markGroupLinked(groupChatId);
  return { taskCount: workflow.length, targetEndDate };
}
