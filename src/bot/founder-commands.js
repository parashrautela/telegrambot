import { createFounderCallbacks } from './founder-callbacks.js';
import { sendMessage } from '../integrations/telegram.js';
import {
  parseUserDate as parseDate,
  createDraftRevision,
  applyReviewDecision,
  resolveDrawing,
  dependencyEdges,
  previewTradeOrderOverride,
} from '../workflow/engine.js';
import crypto from 'node:crypto';
import { aiEnabled } from '../integrations/openai.js';

import { escape, actor } from './message-utils.js';

export function createFounderHandlers({
  askFounderForPlan,
  changeRoleByName,
  changeUserRole,
  config,
  draftFounderGroupMessage,
  founderChatReply,
  founderGroupMessageDrafts,
  isUntouchedLegacyPlan,
  nextProjectId,
  planOverview,
  requestClientResources,
  shareWorkflowResources,
  showProjects,
  store,
}) {
  const projectCreation = new Map();
  const founderRoleAssignments = new Map();
  const { leaderCallback } = createFounderCallbacks({
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
  });
  async function continueProjectCreation(chatId, session) {
    projectCreation.set(chatId, session);
    if (!session.projectName) {
      session.step = 'name';
      return sendMessage(config.leaderToken, chatId, 'Sure — what should I call the project?');
    }
    if (!session.clientName) {
      session.step = 'client';
      return sendMessage(config.leaderToken, chatId, 'Who is the client?');
    }
    if (!session.startDateText) {
      session.step = 'date';
      return sendMessage(
        config.leaderToken,
        chatId,
        'What is the start date? You can say “22 September” or write <code>2026-09-22</code>.',
      );
    }
    session.step = 'group';
    const groups = await store.availableGroups();
    if (!groups.length)
      return sendMessage(
        config.leaderToken,
        chatId,
        'I have the project details. Add the group bot to the project group, send <code>/start</code> there, then tell me “continue creating the project.”',
      );
    return sendMessage(
      config.leaderToken,
      chatId,
      `Ready to set up <b>${escape(session.projectName)}</b>. Which group should I connect?`,
      {
        inline_keyboard: groups
          .slice(0, 10)
          .map((group) => [
            { text: group.GroupTitle, callback_data: `create_group:${group.GroupChatID}` },
          ]),
      },
    );
  }

  async function leaderCommand(message) {
    const command = message.text?.trim().split(/\s+/)[0]?.split('@')[0];
    const startPayload = message.text?.trim().split(/\s+/)[1] || '';
    if (String(message.from.id) !== config.founderTelegramId) {
      if (command === '/start' && startPayload.startsWith('profile_')) {
        const onboarding = await store.onboarding(startPayload.slice('profile_'.length));
        if (onboarding && String(onboarding.TelegramUserID) === String(message.from.id))
          return sendMessage(
            config.leaderToken,
            message.chat.id,
            'Thanks — the founder has been notified and will confirm your project role shortly.',
          );
      }
      console.warn(
        `Ignoring founder-bot message from unauthorized Telegram ID ${message.from.id}.`,
      );
      return;
    }
    console.log(
      `Founder bot received ${message.text?.trim().split(/\s+/)[0] || 'a message'} from the configured founder.`,
    );
    if (command === '/start' || command === '/help')
      return sendMessage(
        config.leaderToken,
        message.chat.id,
        `<b>Founder bot commands</b>\n\n/createproject — create a project shell\n/plan P001 — choose a plan for a waiting or untouched legacy project\n/projects — list projects and progress\n/project P001 — view one project\n/adduser ID | Name | Role — register a team member\n/approvals — review pending requests\n/draft TASK_ID file name | storage ref — record an internal drawing draft\n/review TASK_ID admin|client approved|rework|hold comment — record a drawing decision\n/drawing TASK_ID — show the latest internal drawing revision\n/tradeorder P001 Civil, Electrical — preview a project-only trade order change\n/tradeorder confirm P001 Civil, Electrical — apply that override to the project\n/cancel — cancel the current project-creation flow`,
      );
    if (command === '/cancel') {
      projectCreation.delete(message.chat.id);
      return sendMessage(config.leaderToken, message.chat.id, 'Cancelled.');
    }
    if (command === '/createproject' || command === '/newproject') {
      return continueProjectCreation(message.chat.id, {});
    }
    if (command === '/project') {
      const projectId = message.text.trim().split(/\s+/)[1];
      if (!projectId)
        return sendMessage(
          config.leaderToken,
          message.chat.id,
          'Usage: <code>/project P001</code>',
        );
      const project = await store.projectById(projectId);
      if (!project) return sendMessage(config.leaderToken, message.chat.id, 'Project not found.');
      const tasks = await store.tasksForProject(projectId);
      const completed = tasks.filter((task) => task.Status === 'Completed').length;
      const delayed = tasks.filter(
        (task) => task.Status.includes('Delay') || task.Status.includes('Delayed'),
      ).length;
      return sendMessage(
        config.leaderToken,
        message.chat.id,
        `<b>${escape(project.ProjectName)}</b> (<code>${escape(project.ProjectID)}</code>)\nClient: ${escape(project.ClientName)}\nStatus: ${escape(project.Status)}\nProgress: ${completed}/${tasks.length} complete\nDelays: ${delayed}\nTarget end: ${escape(project.TargetEndDate || 'Not set')}`,
      );
    }
    if (command === '/plan') {
      const projectId = message.text.trim().split(/\s+/)[1];
      if (!projectId)
        return sendMessage(config.leaderToken, message.chat.id, 'Usage: <code>/plan P001</code>');
      const project = await store.projectById(projectId);
      if (!project) return sendMessage(config.leaderToken, message.chat.id, 'Project not found.');
      const tasks = await store.tasksForProject(projectId);
      const legacyPlan = isUntouchedLegacyPlan(project, tasks);
      if (tasks.length && !legacyPlan)
        return sendMessage(
          config.leaderToken,
          message.chat.id,
          'This project already has active work, so its plan cannot be replaced automatically.',
        );
      return askFounderForPlan({
        project,
        clientName: project.ClientName || 'The client',
        replaceUntouchedLegacyPlan: legacyPlan,
      });
    }
    if (command === '/adduser') {
      const raw = message.text.slice(message.text.indexOf(' ') + 1);
      const [telegramId, name, role] = raw.split('|').map((part) => part?.trim());
      if (!telegramId || !name || !role)
        return sendMessage(
          config.leaderToken,
          message.chat.id,
          'Usage: <code>/adduser TELEGRAM_ID | Name | Role</code>',
        );
      const existing = await store.user(telegramId);
      if (existing)
        await store.updateRow('Users', existing.rowNumber, {
          Name: name,
          Role: role,
          Active: 'Yes',
        });
      else
        await store.append('Users', {
          TelegramUserID: telegramId,
          Name: name,
          Role: role,
          Active: 'Yes',
        });
      return sendMessage(
        config.leaderToken,
        message.chat.id,
        `✅ Registered <b>${escape(name)}</b> as ${escape(role)}.`,
      );
    }
    if (command === '/role') {
      const raw = message.text.slice(message.text.indexOf(' ') + 1);
      const [telegramId, role] = raw.split('|').map((part) => part?.trim());
      const user = telegramId && (await store.user(telegramId));
      if (!user || !role)
        return sendMessage(
          config.leaderToken,
          message.chat.id,
          'Usage: <code>/role TELEGRAM_ID | New role</code>',
        );
      return changeUserRole(message.chat.id, user, role);
    }
    if (command === '/projects') {
      return showProjects(message.chat.id);
    }
    if (command === '/approvals') {
      const approvals = await store.approvals();
      const lines = approvals.map(
        (item) =>
          `• <code>${item.ApprovalID}</code> — ${escape(item.RequestType)} for <code>${item.TaskID}</code>: ${escape(item.Reason)}`,
      );
      return sendMessage(
        config.leaderToken,
        message.chat.id,
        lines.length ? `<b>Pending approvals</b>\n\n${lines.join('\n')}` : 'No pending approvals.',
      );
    }
    if (command === '/draft') {
      const [taskId, ...rest] = message.text.trim().split(/\s+/).slice(1);
      const [fileName, storageRef] = rest
        .join(' ')
        .split('|')
        .map((part) => part.trim());
      const task = taskId && (await store.task(taskId));
      if (!task || !fileName || !storageRef)
        return sendMessage(
          config.leaderToken,
          message.chat.id,
          'Usage: <code>/draft TASK_ID file name | storage ref</code>',
        );
      const existing = await store.revisionsForTask(task.TaskID);
      const revision = createDraftRevision({
        revisionId: `REV-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        projectId: task.ProjectID,
        taskId: task.TaskID,
        stage: task.Stage,
        version: existing.length + 1,
        fileName,
        storageRef,
        uploaderRole: 'Designer',
      });
      await store.addDraftRevision(revision);
      await store.audit({
        projectId: task.ProjectID,
        taskId: task.TaskID,
        action: 'Draft revision recorded',
        newValue: revision.RevisionID,
        actor: message.from.id,
        actorName: actor(message.from).name,
        source: 'Telegram founder bot',
        details: fileName,
      });
      return sendMessage(
        config.leaderToken,
        message.chat.id,
        `Internal draft <code>${revision.RevisionID}</code> recorded for <b>${escape(task.TaskName)}</b>. It is not visible to the client or trade team.`,
      );
    }
    if (command === '/review') {
      const [taskId, stage, outcomeKey, ...commentParts] = message.text
        .trim()
        .split(/\s+/)
        .slice(1);
      const outcomes = { approved: 'Approved', rework: 'Rework needed', hold: 'On hold' };
      const outcome = outcomes[outcomeKey];
      const task = taskId && (await store.task(taskId));
      if (!task || !['admin', 'client'].includes(stage) || !outcome)
        return sendMessage(
          config.leaderToken,
          message.chat.id,
          'Usage: <code>/review TASK_ID admin|client approved|rework|hold comment</code>',
        );
      const revisions = await store.revisionsForTask(task.TaskID);
      const revision = [...revisions]
        .sort((left, right) => Number(left.Version) - Number(right.Version))
        .at(-1);
      if (!revision)
        return sendMessage(
          config.leaderToken,
          message.chat.id,
          'Record a draft with /draft before reviewing this task.',
        );
      let decision;
      try {
        decision = applyReviewDecision({ revision, stage, outcome, reviewerRole: 'Project admin' });
      } catch (error) {
        return sendMessage(config.leaderToken, message.chat.id, escape(error.message));
      }
      const decidedAt = new Date().toISOString();
      await store.saveReviewDecision(
        {
          DecisionID: `DEC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
          ProjectID: task.ProjectID,
          TaskID: task.TaskID,
          RevisionID: revision.RevisionID,
          Stage: stage,
          Outcome: outcome,
          ReviewerRole: 'Project admin',
          ReviewerName: actor(message.from).name,
          Comments: commentParts.join(' '),
          DecidedAt: decidedAt,
        },
        { ApprovalState: decision.revision.ApprovalState, Audience: decision.revision.Audience },
      );
      const taskUpdate = {
        ApprovalStatus: decision.revision.ApprovalState,
        LastUpdatedAt: decidedAt,
        LastUpdatedBy: String(message.from.id),
      };
      if (outcome === 'On hold') taskUpdate.Status = 'On hold';
      await store.updateRow('Tasks', task.rowNumber, taskUpdate);
      await store.audit({
        projectId: task.ProjectID,
        taskId: task.TaskID,
        action: `Drawing review ${outcome.toLowerCase()}`,
        newValue: decision.revision.ApprovalState,
        actor: message.from.id,
        actorName: actor(message.from).name,
        source: 'Telegram founder bot',
        details: commentParts.join(' '),
      });
      const reworkNote =
        outcome === 'Rework needed'
          ? '\nThe designer was not reassigned. Designer notification is still unresolved, so no alert was sent.'
          : '';
      return sendMessage(
        config.leaderToken,
        message.chat.id,
        `Review recorded for <b>${escape(task.TaskName)}</b>: ${escape(decision.revision.ApprovalState)}.${reworkNote}`,
      );
    }
    if (command === '/drawing') {
      const task = await store.task(message.text.trim().split(/\s+/)[1]);
      if (!task)
        return sendMessage(
          config.leaderToken,
          message.chat.id,
          'Usage: <code>/drawing TASK_ID</code>',
        );
      const drawing = resolveDrawing(await store.revisionsForTask(task.TaskID), 'Project admin');
      if (!drawing.storageRef)
        return sendMessage(
          config.leaderToken,
          message.chat.id,
          `<b>${escape(task.TaskName)}</b>\n${escape(drawing.status)}. ${escape(drawing.nextStep)}`,
        );
      return sendMessage(
        config.leaderToken,
        message.chat.id,
        `<b>${escape(task.TaskName)}</b>\nLatest internal revision: ${escape(drawing.revision.FileName)} (${escape(drawing.status)})\nRef: <code>${escape(drawing.storageRef)}</code>`,
      );
    }
    if (command === '/tradeorder') {
      const parts = message.text.trim().split(/\s+/).slice(1);
      const confirming = parts[0] === 'confirm';
      const projectId = confirming ? parts[1] : parts[0];
      const order = (confirming ? parts.slice(2) : parts.slice(1))
        .join(' ')
        .split(',')
        .map((trade) => trade.trim())
        .filter(Boolean);
      const project = projectId && (await store.projectById(projectId));
      if (!project || order.length < 2)
        return sendMessage(
          config.leaderToken,
          message.chat.id,
          'Usage: <code>/tradeorder P001 Civil, Electrical, Plumbing</code>\nConfirm with <code>/tradeorder confirm P001 Civil, Electrical, Plumbing</code>',
        );
      const tasks = (await store.tasksForProject(project.ProjectID)).filter(
        (task) => task.TemplateVersion,
      );
      if (!tasks.length)
        return sendMessage(
          config.leaderToken,
          message.chat.id,
          'This project is not using a dependency-based plan.',
        );
      const byId = new Map(tasks.map((task) => [task.TaskID, task]));
      const definitions = tasks.map((task) => ({
        sequence: String(task.Sequence),
        taskName: task.TaskName,
        trade: task.Trade,
        stage: task.Stage,
        durationDays:
          task.ForecastStart && task.ForecastEnd
            ? String(
                Math.round(
                  (new Date(`${task.ForecastEnd}T00:00:00Z`) -
                    new Date(`${task.ForecastStart}T00:00:00Z`)) /
                    86400000,
                ) + 1,
              )
            : '',
        predecessors: dependencyEdges(task).map((edge) => ({
          sequence: String(byId.get(edge.id)?.Sequence || ''),
          type: edge.type,
        })),
        workflowId: task.WorkflowID,
        defaultRole: task.AssignedRole,
        required: 'Yes',
        milestone: 'No',
        gateType: task.GateType,
        audience: task.Audience,
        phase: task.Phase,
        templateVersion: task.TemplateVersion,
      }));
      const durationBySequence = Object.fromEntries(
        definitions
          .filter((definition) => definition.durationDays)
          .map((definition) => [definition.sequence, Number(definition.durationDays)]),
      );
      let preview;
      try {
        preview = previewTradeOrderOverride(definitions, order, {
          startDate: project.StartDate,
          durationBySequence,
        });
      } catch (error) {
        return sendMessage(config.leaderToken, message.chat.id, escape(error.message));
      }
      if (!confirming) {
        const edgeLines = preview.changedEdges.map((edge) => `• ${escape(edge.taskName)}`);
        const forecastLines = preview.forecastDiffs
          .slice(0, 8)
          .map(
            (diff) =>
              `• ${escape(diff.taskName)}: ${escape(diff.previousForecastStart || 'unset')} → ${escape(diff.forecastStart || 'unset')}`,
          );
        return sendMessage(
          config.leaderToken,
          message.chat.id,
          `<b>Trade order preview</b>\nShared template: unchanged\nChanged links:\n${edgeLines.join('\n') || 'None'}\n\nForecast changes:\n${forecastLines.join('\n') || 'None — durations are still unconfirmed.'}\n\nReply with <code>/tradeorder confirm ${escape(project.ProjectID)} ${escape(order.join(', '))}</code> to apply this to the project only.`,
        );
      }
      const idForSequence = new Map(tasks.map((task) => [String(task.Sequence), task]));
      for (const definition of preview.definitions) {
        const task = idForSequence.get(String(definition.sequence));
        const predecessorIds = definition.predecessors
          .map((edge) => `${idForSequence.get(String(edge.sequence)).TaskID}:${edge.type}`)
          .join(',');
        if (task.PredecessorTaskIDs === predecessorIds) continue;
        await store.updateRow('Tasks', task.rowNumber, { PredecessorTaskIDs: predecessorIds });
      }
      for (const diff of preview.forecastDiffs) {
        const task = idForSequence.get(String(diff.sequence));
        if (
          !task ||
          task.ActualStart ||
          ['In Progress', 'Completed', 'On hold'].includes(task.Status)
        )
          continue;
        await store.updateRow('Tasks', task.rowNumber, {
          ForecastStart: diff.forecastStart,
          ForecastEnd: diff.forecastEnd,
        });
      }
      await store.audit({
        projectId: project.ProjectID,
        action: 'Trade order override',
        newValue: order.join(', '),
        actor: message.from.id,
        actorName: actor(message.from).name,
        source: 'Telegram founder bot',
        details: `${preview.changedEdges.length} procurement link(s) changed on this project only`,
      });
      return sendMessage(
        config.leaderToken,
        message.chat.id,
        `Trade order applied to <b>${escape(project.ProjectName)}</b>. The shared template was not changed.`,
      );
    }
  }

  async function leaderCreationReply(message) {
    if (String(message.from.id) !== config.founderTelegramId) return;
    const session = projectCreation.get(message.chat.id);
    if (!session || message.text?.startsWith('/')) return;
    const reply = message.text.trim();
    if (session.step === 'group') return continueProjectCreation(message.chat.id, session);
    if (session.step === 'name') {
      session.projectName = reply;
      session.step = 'client';
      return sendMessage(config.leaderToken, message.chat.id, 'Who is the <b>client</b>?');
    }
    if (session.step === 'client') {
      session.clientName = reply;
      session.step = 'date';
      return sendMessage(
        config.leaderToken,
        message.chat.id,
        'What is the <b>start date</b>? You can write <code>2026-09-20</code> or <code>20 September</code>.',
      );
    }
    if (session.step === 'date') {
      const parsedDate = parseDate(reply);
      if (!parsedDate)
        return sendMessage(
          config.leaderToken,
          message.chat.id,
          'I could not read that date. Try <code>2026-09-20</code>.',
        );
      session.startDateText = parsedDate;
      return continueProjectCreation(message.chat.id, session);
    }
  }

  async function leaderNaturalLanguageReply(message) {
    if (String(message.from.id) !== config.founderTelegramId) return;
    const onboardingId = founderRoleAssignments.get(message.chat.id);
    if (onboardingId) {
      const [name, role] = message.text.split('|').map((part) => part?.trim());
      if (!name || !role)
        return sendMessage(
          config.leaderToken,
          message.chat.id,
          'Please use <code>Full name | Role</code>, for example <code>Rahul Sharma | Electrical contractor</code>.',
        );
      const onboarding = await store.onboarding(onboardingId);
      if (!onboarding || onboarding.Status !== 'Pending') {
        founderRoleAssignments.delete(message.chat.id);
        return sendMessage(
          config.leaderToken,
          message.chat.id,
          'That member profile is no longer pending.',
        );
      }
      await store.approveOnboarding(onboarding, {
        name,
        role,
        founderTelegramId: config.founderTelegramId,
      });
      await store.audit({
        projectId: onboarding.ProjectID,
        action: 'Member profile approved',
        actor: config.founderTelegramId,
        actorName: 'Founder',
        source: 'Telegram founder bot',
        details: `${name} | ${role}`,
      });
      founderRoleAssignments.delete(message.chat.id);
      await sendMessage(
        config.groupToken,
        onboarding.GroupChatID,
        `✅ <b>${escape(name)}</b> is now active on this project as <b>${escape(role)}</b>.`,
      );
      try {
        await sendMessage(
          config.leaderToken,
          onboarding.TelegramUserID,
          `Your project profile is active. Role: <b>${escape(role)}</b>.`,
        );
      } catch {
        console.log('New member has not started the founder bot yet.');
      }
      const project = await store.projectById(onboarding.ProjectID);
      const projectTasks = project ? await store.tasksForProject(project.ProjectID) : [];
      const legacyPlan = project && isUntouchedLegacyPlan(project, projectTasks);
      if (project && /\bclient\b/i.test(role) && (!projectTasks.length || legacyPlan)) {
        await store.updateRow('Projects', project.rowNumber, { ClientName: name });
        project.ClientName = name;
        await askFounderForPlan({
          project,
          clientName: name,
          replaceUntouchedLegacyPlan: legacyPlan,
        });
        return sendMessage(
          config.leaderToken,
          message.chat.id,
          `✅ ${escape(name)} is now active as ${escape(role)}. I’ve also asked which workflow to assign.`,
        );
      }
      return sendMessage(
        config.leaderToken,
        message.chat.id,
        `✅ ${escape(name)} is now active as ${escape(role)}.`,
      );
    }
    const session = projectCreation.get(message.chat.id);
    if (session) return leaderCreationReply(message);
    const normalized = message.text.trim().toLowerCase();
    const roleMatch = message.text.match(
      /(?:change|update|set|make)\s+(.+?)(?:'s)?\s+role\s+(?:to|as)\s+(.+)/i,
    );
    if (roleMatch) return changeRoleByName(message.chat.id, roleMatch[1], roleMatch[2].trim());
    if (/\b(start|create|make|begin|new)\b.*\bproject\b/.test(normalized))
      return continueProjectCreation(message.chat.id, {});
    if (/\b(show|list|view)\b.*\bprojects?\b/.test(normalized))
      return showProjects(message.chat.id);
    if (aiEnabled() && /\b(send|post|ask|message|write|tell|share|request)\b/i.test(message.text)) {
      try {
        if (await draftFounderGroupMessage(message)) return;
      } catch (error) {
        console.error('Founder group message draft error:', error.message);
        return sendMessage(
          config.leaderToken,
          message.chat.id,
          'I could not prepare that group message just now. Please try again.',
        );
      }
    }
    if (/\b(update|status|progress|going)\b/.test(normalized)) {
      const projects = await store.rows('Projects');
      const match = projects.find((project) =>
        normalized.includes(project.ProjectName.toLowerCase()),
      );
      if (match) return leaderCommand({ ...message, text: `/project ${match.ProjectID}` });
      const activeProjects = projects.filter((project) => project.Status !== 'Archived');
      if (activeProjects.length === 1)
        return leaderCommand({ ...message, text: `/project ${activeProjects[0].ProjectID}` });
      if (activeProjects.length > 1) {
        const options = activeProjects
          .map(
            (project) =>
              `• <b>${escape(project.ProjectName)}</b> (<code>${escape(project.ProjectID)}</code>)`,
          )
          .join('\n');
        return sendMessage(
          config.leaderToken,
          message.chat.id,
          `Which project would you like an update on?\n\n${options}`,
        );
      }
      return sendMessage(
        config.leaderToken,
        message.chat.id,
        'There are no active projects yet. Say “start a project” whenever you are ready.',
      );
    }
    if (!aiEnabled())
      return sendMessage(
        config.leaderToken,
        message.chat.id,
        'I can help with projects, but AI is not configured yet. You can still use /help.',
      );
    try {
      return await founderChatReply(message);
    } catch (error) {
      console.error('Founder chat error:', error.message);
      return sendMessage(
        config.leaderToken,
        message.chat.id,
        'I hit a small snag replying just now. Try once more, or use /help for the project controls.',
      );
    }
  }

  return { leaderCommand, leaderNaturalLanguageReply, leaderCallback };
}
