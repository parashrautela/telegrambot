import { answerCallback, sendMessage } from '../integrations/telegram.js';
import { escape, actor } from './message-utils.js';
import { WORKFLOW_OPTIONS } from '../workflow/schema.js';
import { withForecastDefaults, forecastDelayImpact, projectedFinish } from '../workflow/engine.js';

export function createFounderCallbacks({
  config,
  founderGroupMessageDrafts,
  founderRoleAssignments,
  isUntouchedLegacyPlan,
  nextProjectId,
  planOverview,
  projectCreation,
  requestClientResources,
  shareWorkflowResources,
  store,
}) {
  async function leaderCallback(callback) {
    if (callback.data.startsWith('group_send:') || callback.data.startsWith('group_cancel:')) {
      if (String(callback.from.id) !== config.founderTelegramId)
        return answerCallback(
          config.leaderToken,
          callback.id,
          'Only the founder can send project messages.',
        );
      const [action, draftId] = callback.data.split(':');
      const draft = founderGroupMessageDrafts.get(draftId);
      if (!draft || Date.now() - draft.createdAt > 15 * 60 * 1000) {
        founderGroupMessageDrafts.delete(draftId);
        return answerCallback(
          config.leaderToken,
          callback.id,
          'This draft expired. Please ask me to prepare the message again.',
        );
      }
      if (action === 'group_cancel') {
        founderGroupMessageDrafts.delete(draftId);
        return answerCallback(
          config.leaderToken,
          callback.id,
          'Cancelled. No group message was sent.',
        );
      }
      if (draft.sending)
        return answerCallback(
          config.leaderToken,
          callback.id,
          'This message is already being sent.',
        );
      const project = await store.projectById(draft.projectId);
      if (!project || !project.GroupChatID || ['Completed', 'Abandoned'].includes(project.Status)) {
        founderGroupMessageDrafts.delete(draftId);
        return answerCallback(
          config.leaderToken,
          callback.id,
          'This project group is no longer active.',
        );
      }
      draft.sending = true;
      try {
        await sendMessage(config.groupToken, project.GroupChatID, escape(draft.text));
      } catch (error) {
        draft.sending = false;
        console.error('Founder group message error:', error.message);
        await answerCallback(
          config.leaderToken,
          callback.id,
          'Could not send to the project group.',
        );
        return sendMessage(
          config.leaderToken,
          callback.message.chat.id,
          `I could not post to <b>${escape(project.ProjectName)}</b>. Please check that the project group bot is still in that group, then tap Send again.`,
        );
      }
      founderGroupMessageDrafts.delete(draftId);
      await answerCallback(config.leaderToken, callback.id, 'Sent to the project group.');
      try {
        await store.audit({
          projectId: project.ProjectID,
          action: 'Founder group message sent',
          actor: callback.from.id,
          actorName: actor(callback.from).name,
          source: 'Telegram founder bot',
          details: draft.text,
        });
      } catch (error) {
        console.error('Founder group message audit error:', error.message);
      }
      return sendMessage(
        config.leaderToken,
        callback.message.chat.id,
        `✅ Sent to <b>${escape(project.ProjectName)}</b>.`,
      );
    }
    if (callback.data.startsWith('close_project:')) {
      if (String(callback.from.id) !== config.founderTelegramId)
        return answerCallback(
          config.leaderToken,
          callback.id,
          'Only the founder can close a project.',
        );
      const [, projectId, decision] = callback.data.split(':');
      const project = await store.projectById(projectId);
      if (!project)
        return answerCallback(config.leaderToken, callback.id, 'This project no longer exists.');
      if (decision === 'keep_active') {
        await store.audit({
          projectId,
          action: 'Founder departure dismissed',
          actor: callback.from.id,
          actorName: actor(callback.from).name,
          source: 'Telegram founder bot',
          details: 'Founder chose to keep the project active.',
        });
        await answerCallback(config.leaderToken, callback.id, 'Project remains active.');
        return sendMessage(
          config.leaderToken,
          callback.message.chat.id,
          `Got it — <b>${escape(project.ProjectName)}</b> remains active. Nothing was changed.`,
        );
      }
      const outcome =
        decision === 'completed' ? 'Completed' : decision === 'abandoned' ? 'Abandoned' : '';
      if (!outcome)
        return answerCallback(config.leaderToken, callback.id, 'Unknown project-closure decision.');
      if (['Completed', 'Abandoned'].includes(project.Status))
        return answerCallback(config.leaderToken, callback.id, 'This project is already closed.');
      try {
        const result = await store.closeProject({
          project,
          outcome,
          actorTelegramId: callback.from.id,
          actorName: actor(callback.from).name,
        });
        await answerCallback(
          config.leaderToken,
          callback.id,
          `Project marked ${outcome.toLowerCase()}.`,
        );
        await sendMessage(
          config.leaderToken,
          callback.message.chat.id,
          `✅ <b>${escape(project.ProjectName)}</b> is now <b>${outcome.toLowerCase()}</b>.\n\nNo data was deleted. ${result.closedTasks} unfinished task(s) were closed, and ${result.deactivatedMembers} project member record(s) were deactivated.`,
        );
        return sendMessage(
          config.groupToken,
          project.GroupChatID,
          `<b>Project closed — ${escape(outcome)}</b>\n\nThe founder closed this project. Its full history is retained, but task updates are no longer active.`,
        );
      } catch (error) {
        console.error('Project closure error:', error.message);
        return answerCallback(
          config.leaderToken,
          callback.id,
          'Could not close this project. Check the Railway logs.',
        );
      }
    }
    if (callback.data.startsWith('choose_plan:')) {
      if (String(callback.from.id) !== config.founderTelegramId)
        return answerCallback(
          config.leaderToken,
          callback.id,
          'Only the founder can assign a project plan.',
        );
      const [, projectId, workflowId] = callback.data.split(':');
      const option = WORKFLOW_OPTIONS.find((item) => item.id === workflowId);
      const project = await store.projectById(projectId);
      if (!option || !project)
        return answerCallback(
          config.leaderToken,
          callback.id,
          'That project plan is no longer available.',
        );
      const existingTasks = await store.tasksForProject(projectId);
      const legacyPlan = isUntouchedLegacyPlan(project, existingTasks);
      if (existingTasks.length && !legacyPlan)
        return answerCallback(
          config.leaderToken,
          callback.id,
          'This project already has active work, so its plan cannot be replaced automatically.',
        );
      try {
        const { assignWorkflowToProject } = await import('./projects/service.js');
        const result = await assignWorkflowToProject({
          store,
          project,
          workflowId,
          actorTelegramId: config.founderTelegramId,
          replaceUntouchedLegacyPlan: legacyPlan,
        });
        await answerCallback(config.leaderToken, callback.id, 'Project plan assigned.');
        await sendMessage(
          config.leaderToken,
          callback.message.chat.id,
          `✅ <b>${escape(option.label)}</b> assigned to <b>${escape(project.ProjectName)}</b>.\n${result.taskCount} tasks generated. Planned finish: ${escape(result.targetEndDate)}.`,
        );
        await sendMessage(
          config.groupToken,
          project.GroupChatID,
          `<b>Project plan assigned — ${escape(option.label)}</b>\n\n${planOverview(result.workflow)}\n\n${result.taskCount} tasks are now active. Use /tasks to see the full plan.`,
        );
        await requestClientResources(project, result.workflow);
        await shareWorkflowResources(project, workflowId);
        return;
      } catch (error) {
        console.error('Workflow assignment error:', error.message);
        return answerCallback(
          config.leaderToken,
          callback.id,
          'Could not assign this plan. Check the Railway logs.',
        );
      }
    }
    if (callback.data.startsWith('onboard_role:')) {
      if (String(callback.from.id) !== config.founderTelegramId)
        return answerCallback(
          config.leaderToken,
          callback.id,
          'Only the founder can assign project roles.',
        );
      const onboarding = await store.onboarding(callback.data.slice('onboard_role:'.length));
      if (!onboarding || onboarding.Status !== 'Pending')
        return answerCallback(
          config.leaderToken,
          callback.id,
          'This member profile is no longer pending.',
        );
      founderRoleAssignments.set(callback.message.chat.id, onboarding.OnboardingID);
      await answerCallback(config.leaderToken, callback.id, 'Reply with name and role.');
      return sendMessage(
        config.leaderToken,
        callback.message.chat.id,
        `Reply with this member’s profile in one line:\n<code>Full name | Role</code>\n\nExample: <code>Rahul Sharma | Electrical contractor</code>`,
      );
    }
    if (callback.data.startsWith('create_group:')) {
      if (String(callback.from.id) !== config.founderTelegramId)
        return answerCallback(
          config.leaderToken,
          callback.id,
          'Only the founder can create a project.',
        );
      const session = projectCreation.get(callback.message.chat.id);
      if (!session || session.step !== 'group')
        return answerCallback(
          config.leaderToken,
          callback.id,
          'Project creation session expired. Start /createproject again.',
        );
      const groupChatId = callback.data.slice('create_group:'.length);
      try {
        const projectId = await nextProjectId();
        const { createProjectShell } = await import('./projects/service.js');
        await createProjectShell({
          store,
          projectId,
          projectName: session.projectName,
          clientName: session.clientName,
          startDateText: session.startDateText,
          groupChatId,
          leaderTelegramId: config.founderTelegramId,
        });
        projectCreation.delete(callback.message.chat.id);
        await answerCallback(config.leaderToken, callback.id, 'Project created.');
        await sendMessage(
          config.leaderToken,
          callback.message.chat.id,
          `✅ <b>${escape(session.projectName)}</b> created as <code>${projectId}</code>.\n\nIt is waiting for the client to join the group. Once you approve their role as <b>Client</b>, I’ll ask you which plan to assign.`,
        );
        return sendMessage(
          config.groupToken,
          groupChatId,
          `🏠 <b>${escape(session.projectName)}</b> is now connected.\n\nAdd the client to this group. Once the founder confirms them as <b>Client</b>, the founder bot will select the project plan and share its linked resources here.`,
        );
      } catch (error) {
        console.error('Project creation error:', error.message);
        return answerCallback(
          config.leaderToken,
          callback.id,
          'Could not create project. Check the logs.',
        );
      }
    }
    const [decision, approvalId] = callback.data.split(':');
    const approval = (await store.approvals()).find((item) => item.ApprovalID === approvalId);
    if (!approval)
      return answerCallback(config.leaderToken, callback.id, 'Approval is no longer pending.');
    const project = await store.projectById(approval.ProjectID);
    const isFounder = String(callback.from.id) === config.founderTelegramId;
    const isProjectLead = project && String(callback.from.id) === String(project.LeaderTelegramID);
    if (!isFounder && !isProjectLead)
      return answerCallback(
        config.leaderToken,
        callback.id,
        'Only the founder or project lead can decide.',
      );
    const task = await store.task(approval.TaskID);
    const status = decision === 'approve' ? 'Approved' : 'Rejected';
    // Every plan goes through the engine. Legacy rows get their forecast seeded from current dates first.
    const seeded =
      decision === 'approve'
        ? withForecastDefaults(await store.tasksForProject(task.ProjectID))
        : [];
    const forecast =
      decision === 'approve'
        ? forecastDelayImpact(seeded, task.TaskID, Number(approval.DelayDays))
        : null;
    await store.updateRow('Approvals', approval.rowNumber, {
      Status: status,
      DecidedAt: new Date().toISOString(),
      DecidedByTelegramID: String(callback.from.id),
    });
    await store.updateRow('Tasks', task.rowNumber, {
      Status: decision === 'approve' ? 'Delayed — Approved' : 'Delay Rejected',
      ApprovalStatus: status,
      LastUpdatedAt: new Date().toISOString(),
      LastUpdatedBy: String(callback.from.id),
    });
    if (forecast) {
      const before = new Map(seeded.map((item) => [item.TaskID, item]));
      const currentTasks = await store.tasksForProject(task.ProjectID);
      for (const updated of forecast.tasks) {
        const previous = before.get(updated.TaskID);
        const current = currentTasks.find((item) => item.TaskID === updated.TaskID);
        if (
          !current ||
          (previous.ForecastStart === updated.ForecastStart &&
            previous.ForecastEnd === updated.ForecastEnd)
        )
          continue;
        await store.updateRow('Tasks', current.rowNumber, {
          ForecastStart: updated.ForecastStart,
          ForecastEnd: updated.ForecastEnd,
        });
      }
      const finish = projectedFinish(forecast.tasks);
      if (finish && project && finish !== project.TargetEndDate)
        await store.updateRow('Projects', project.rowNumber, { TargetEndDate: finish });
    }
    await store.audit({
      projectId: approval.ProjectID,
      taskId: task.TaskID,
      action: `Delay ${status.toLowerCase()}`,
      oldValue: 'Delay Requested',
      newValue: status,
      actor: callback.from.id,
      actorName: actor(callback.from).name,
      source: 'Telegram leader bot',
      details: approval.Reason,
    });
    await answerCallback(config.leaderToken, callback.id, `Delay ${status.toLowerCase()}.`);
    await sendMessage(
      config.leaderToken,
      callback.message.chat.id,
      `✅ Delay request <code>${approvalId}</code> ${status.toLowerCase()}.`,
    );
    return sendMessage(
      config.groupToken,
      approval.GroupChatID,
      `${decision === 'approve' ? '✅' : '❌'} The founder ${status.toLowerCase()} the delay for <b>${escape(task.TaskName)}</b>.\nReason: ${escape(approval.Reason)}`,
    );
  }
  return { leaderCallback };
}
