import { sendMessage } from '../integrations/telegram.js';
import { WORKFLOW_OPTIONS } from '../workflow/schema.js';
import { escape } from './message-utils.js';

export function createProjectHandlers({ config, store }) {
  async function nextProjectId() {
    const projectIds = (await store.rows('Projects')).map((project) => project.ProjectID);
    let number = 1;
    while (projectIds.includes(`P${String(number).padStart(3, '0')}`)) number += 1;
    return `P${String(number).padStart(3, '0')}`;
  }

  async function projectTldr(project) {
    const tasks = (await store.tasksForProject(project.ProjectID)).sort(
      (left, right) => Number(left.Sequence) - Number(right.Sequence),
    );
    const completed = tasks.filter((task) => task.Status === 'Completed').length;
    const current = tasks.find((task) => !['Completed', 'Archived'].includes(task.Status));
    const issues = tasks.filter((task) => task.Status === 'Issue Reported').length;
    const delays = tasks.filter((task) => task.Status.includes('Delay')).length;
    const approvals = (await store.approvals()).filter(
      (item) => item.ProjectID === project.ProjectID,
    ).length;
    const blockers = [
      issues ? `${issues} reported issue${issues === 1 ? '' : 's'}` : '',
      delays ? `${delays} delay${delays === 1 ? '' : 's'}` : '',
      approvals ? `${approvals} approval${approvals === 1 ? '' : 's'} pending` : '',
    ].filter(Boolean);
    return [
      `<b>Project TLDR — ${escape(project.ProjectName)}</b>`,
      `Progress: ${completed}/${tasks.length} tasks complete`,
      `Current stage: ${escape(current?.Stage || 'Project complete')}`,
      `Now: ${escape(current?.TaskName || 'All planned tasks are complete')}`,
      `Stuck on: ${blockers.length ? escape(blockers.join(' · ')) : 'No recorded blockers'}`,
      `Next milestone: ${escape(current?.TaskName || 'Project handover')}`,
    ].join('\n');
  }

  function planOverview(workflow) {
    const stages = [];
    for (const task of workflow) {
      const existing = stages.find((stage) => stage.name === task.Stage);
      if (existing) existing.count += 1;
      else stages.push({ name: task.Stage, count: 1 });
    }
    return stages
      .map(
        (stage) => `• ${escape(stage.name)} — ${stage.count} task${stage.count === 1 ? '' : 's'}`,
      )
      .join('\n');
  }

  function isUntouchedLegacyPlan(project, tasks) {
    return (
      project.Notes === 'Pilot project generated from HOUSE-V1.' &&
      tasks.length > 0 &&
      tasks.every((task) => task.WorkflowID === 'HOUSE-V1' && task.Status === 'Pending')
    );
  }

  async function askFounderForPlan({ project, clientName, replaceUntouchedLegacyPlan = false }) {
    const legacyNote = replaceUntouchedLegacyPlan
      ? '\n\nThis project has an untouched legacy house plan. Choosing an option will archive those unused task records and generate the selected plan; nothing is deleted.'
      : '';
    return sendMessage(
      config.leaderToken,
      config.founderTelegramId,
      `<b>Client profile complete</b>\n\n${escape(clientName)} is now marked as the client for <b>${escape(project.ProjectName)}</b>. Which plan should we assign?\n\nThe selected plan will generate the project tasks and share its linked resources with the group.${legacyNote}`,
      {
        inline_keyboard: WORKFLOW_OPTIONS.map((option) => [
          { text: option.label, callback_data: `choose_plan:${project.ProjectID}:${option.id}` },
        ]),
      },
    );
  }

  async function showProjects(chatId) {
    const projects = await store.rows('Projects');
    const lines = await Promise.all(
      projects.map(async (project) => {
        const tasks = await store.tasksForProject(project.ProjectID);
        const completed = tasks.filter((task) => task.Status === 'Completed').length;
        return `• <b>${escape(project.ProjectName)}</b> — ${completed}/${tasks.length} tasks complete · ${escape(project.Status || 'Active')}`;
      }),
    );
    return sendMessage(
      config.leaderToken,
      chatId,
      lines.length
        ? `<b>Projects</b>\n\n${lines.join('\n')}`
        : 'No projects exist yet. Say “start a project” whenever you are ready.',
    );
  }
  return {
    nextProjectId,
    projectTldr,
    planOverview,
    isUntouchedLegacyPlan,
    askFounderForPlan,
    showProjects,
  };
}
