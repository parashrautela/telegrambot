import { sendMessage, answerCallback } from '../integrations/telegram.js';
import { completionBlockReason, resolveDrawing } from '../workflow/engine.js';
import { aiEnabled, interpretProjectUpdate } from '../integrations/openai.js';
import crypto from 'node:crypto';
import { groupOnly, escape, actor } from './message-utils.js';

export function createGroupHandlers({ config, recordGroupMember, store }) {
  const aiDrafts = new Map();
  async function requireProject(chat, token) {
    if (!groupOnly(chat)) {
      await sendMessage(
        token,
        chat.id,
        'Please use this command inside the project Telegram group.',
      );
      return null;
    }
    const project = await store.projectForGroup(chat.id);
    if (!project) {
      await store.registerGroup(chat.id, chat.title || 'Unnamed project group');
      await sendMessage(
        token,
        chat.id,
        `This group is registered and ready to link to a project.\nGroup Chat ID: <code>${chat.id}</code>\nOpen the founder bot and use /createproject.`,
      );
      return null;
    }
    if (['Completed', 'Abandoned'].includes(project.Status)) {
      await sendMessage(
        token,
        chat.id,
        `This project is <b>${escape(project.Status.toLowerCase())}</b>. Its history is retained, but task updates are closed.`,
      );
      return null;
    }
    return project;
  }

  async function verifyAssigned(task, from, token, chatId) {
    const groupMember = await store.groupMember(chatId, from.id);
    const knownUser = groupMember
      ? groupMember.MembershipStatus === 'Active' && groupMember.AssignedRole
        ? groupMember
        : null
      : await store.user(from.id);
    if (!knownUser && String(from.id) !== config.founderTelegramId) {
      await sendMessage(
        token,
        chatId,
        'You are not registered as an active project user yet. Ask the founder to add your Telegram ID to the Users sheet.',
      );
      return false;
    }
    if (
      task.AssignedTelegramID &&
      String(task.AssignedTelegramID) !== String(from.id) &&
      String(from.id) !== config.founderTelegramId
    ) {
      await sendMessage(
        token,
        chatId,
        `Only the assigned team member or the founder can update <code>${task.TaskID}</code>.`,
      );
      return false;
    }
    return true;
  }

  async function submitDelay({ project, task, user, days, reason, groupChatId }) {
    const approvalId = await store.requestDelay({ project, task, actor: user, days, reason });
    const approverTelegramId = project.LeaderTelegramID || config.founderTelegramId;
    await sendMessage(
      config.groupToken,
      groupChatId,
      `⏳ Delay request sent for approval: <b>${escape(task.TaskName)}</b> — ${days} day(s).`,
    );
    return sendMessage(
      config.leaderToken,
      approverTelegramId,
      `<b>Delay approval needed</b>\n\nProject: ${escape(project.ProjectName)}\nTask: ${escape(task.TaskName)}\nRequested by: ${escape(user.name)}\nDelay: ${days} day(s)\nReason: ${escape(reason)}`,
      {
        inline_keyboard: [
          [
            { text: 'Approve', callback_data: `approve:${approvalId}` },
            { text: 'Reject', callback_data: `reject:${approvalId}` },
          ],
        ],
      },
    );
  }

  async function submitIssue({ project, task, user, issue, groupChatId }) {
    await store.updateRow('Tasks', task.rowNumber, {
      Status: 'Issue Reported',
      IssueText: issue,
      LastUpdatedAt: new Date().toISOString(),
      LastUpdatedBy: String(user.id),
    });
    await store.audit({
      projectId: project.ProjectID,
      taskId: task.TaskID,
      action: 'Issue reported',
      oldValue: task.Status,
      newValue: 'Issue Reported',
      actor: user.id,
      actorName: user.name,
      source: 'Telegram group bot',
      details: issue,
    });
    const recipientTelegramId = project.LeaderTelegramID || config.founderTelegramId;
    await sendMessage(
      config.groupToken,
      groupChatId,
      `⚠️ Issue recorded for <b>${escape(task.TaskName)}</b>. The project lead has been notified.`,
    );
    return sendMessage(
      config.leaderToken,
      recipientTelegramId,
      `⚠️ <b>Issue reported</b>\nProject: ${escape(project.ProjectName)}\nTask: ${escape(task.TaskName)}\nBy: ${escape(user.name)}\n\n${escape(issue)}`,
    );
  }

  async function finishTask({ project, task, user, token, chatId }) {
    const tasks = await store.tasksForProject(project.ProjectID);
    const revisions = task.GateType ? await store.revisionsForTask(task.TaskID) : [];
    const block = completionBlockReason(task, tasks, revisions);
    if (block)
      return sendMessage(
        token,
        chatId,
        `Cannot complete <b>${escape(task.TaskName)}</b>. ${escape(block)}.`,
      );
    await store.updateRow('Tasks', task.rowNumber, {
      Status: 'Completed',
      ApprovalStatus: task.GateType === 'approval' ? 'Client approved' : '',
      LastUpdatedAt: new Date().toISOString(),
      LastUpdatedBy: String(user.id),
    });
    await store.audit({
      projectId: project.ProjectID,
      taskId: task.TaskID,
      action: 'Task completed',
      oldValue: task.Status,
      newValue: 'Completed',
      actor: user.id,
      actorName: user.name,
      source: 'Telegram group bot',
    });
    return sendMessage(
      token,
      chatId,
      `✅ <b>${escape(task.TaskName)}</b> marked completed by ${escape(user.name)}.`,
    );
  }

  async function submitCompletion({ project, task, user, groupChatId }) {
    return finishTask({ project, task, user, token: config.groupToken, chatId: groupChatId });
  }

  async function interpretNaturalLanguage(message, project, naturalLanguageUpdate) {
    if (!aiEnabled())
      return sendMessage(
        config.groupToken,
        message.chat.id,
        'AI is not configured yet. The founder needs to add OPENAI_API_KEY to .env and restart the bot.',
      );
    try {
      const result = await interpretProjectUpdate({
        project,
        tasks: await store.tasksForProject(project.ProjectID),
        message: naturalLanguageUpdate,
      });
      const task = result.task_id ? await store.task(result.task_id) : null;
      if (!task || !['delay', 'issue', 'complete'].includes(result.action)) {
        return sendMessage(
          config.groupToken,
          message.chat.id,
          result.clarification_question ||
            'I could not identify a safe project action. Please tell me which task you mean.',
        );
      }
      const requiresDetails =
        (result.action === 'delay' && (!result.delay_days || !result.reason)) ||
        (result.action === 'issue' && !result.reason);
      if (requiresDetails)
        return sendMessage(
          config.groupToken,
          message.chat.id,
          result.clarification_question ||
            'I need the delay duration or issue details before I can draft that update.',
        );
      const draftId = crypto.randomUUID().slice(0, 12);
      aiDrafts.set(draftId, {
        project,
        task,
        result,
        user: actor(message.from),
        groupChatId: message.chat.id,
        createdAt: Date.now(),
      });
      const label =
        result.action === 'delay'
          ? `Delay: ${result.delay_days} day(s)`
          : result.action === 'issue'
            ? 'Issue report'
            : 'Mark completed';
      const detail = result.reason ? `\nReason: ${escape(result.reason)}` : '';
      return sendMessage(
        config.groupToken,
        message.chat.id,
        `🤖 <b>Proposed update</b>\nTask: <b>${escape(task.TaskName)}</b>\nAction: ${label}${detail}\n\nWould you like me to submit this?`,
        {
          inline_keyboard: [
            [
              { text: 'Confirm', callback_data: `ai_confirm:${draftId}` },
              { text: 'Cancel', callback_data: `ai_cancel:${draftId}` },
            ],
          ],
        },
      );
    } catch (error) {
      console.error('AI interpretation error:', error.message);
      return sendMessage(
        config.groupToken,
        message.chat.id,
        'I could not interpret that update right now. Please try again or use /delay, /issue, or /done.',
      );
    }
  }

  async function groupCommand(message) {
    const text = message.text?.trim() ?? '';
    const [rawCommand, ...argumentsList] = text.split(/\s+/);
    const command = rawCommand?.split('@')[0];
    if (groupOnly(message.chat) && (command === '/start' || command === '/join')) {
      await recordGroupMember(message.chat, message.from, 'Active');
      if (command === '/join')
        return sendMessage(
          config.groupToken,
          message.chat.id,
          `Registered <b>${escape(actor(message.from).name)}</b> in this group. The founder can now assign a project name and role in the web app.`,
        );
    }
    if (groupOnly(message.chat) && command === '/roster') {
      const members = (await store.rows('GroupMembers')).filter(
        (item) =>
          String(item.GroupChatID) === String(message.chat.id) &&
          item.MembershipStatus === 'Active',
      );
      const lines = members.map(
        (member) =>
          `• ${escape(member.AssignedName || member.TelegramName)} — ${escape(member.AssignedRole || 'Role pending')}`,
      );
      return sendMessage(
        config.groupToken,
        message.chat.id,
        `<b>Project team</b>\n${lines.join('\n') || 'No members recorded yet. Ask members to send /join.'}`,
      );
    }
    const project = await requireProject(message.chat, config.groupToken);
    if (!project) return;
    const user = actor(message.from);

    if (command === '/start') {
      await sendMessage(
        config.groupToken,
        message.chat.id,
        `Connected to <b>${escape(project.ProjectName)}</b>.\nTelegram group chat ID: <code>${escape(message.chat.id)}</code>\nUse /tasks to see active work.`,
        null,
      );
      return;
    }
    if (command === '/tasks') {
      const tasks = (await store.tasksForProject(project.ProjectID)).filter(
        (task) =>
          task.Status !== 'Completed' && !/^(Archived|Cancelled|Closed)/.test(task.Status || ''),
      );
      if (!tasks.length)
        return sendMessage(
          config.groupToken,
          message.chat.id,
          'No active tasks are currently recorded for this project.',
        );
      const lines = tasks
        .slice(0, 12)
        .map(
          (task) =>
            `• <code>${task.TaskID}</code> — <b>${escape(task.TaskName)}</b>\n  ${escape(task.Status || 'Pending')} · ${escape(task.AssignedName || task.AssignedRole || 'Unassigned')} · ${escape(task.ForecastEnd || task.CurrentEnd || task.PlannedEnd || 'No date')}`,
        );
      return sendMessage(
        config.groupToken,
        message.chat.id,
        `<b>${escape(project.ProjectName)} — active tasks</b>\n\n${lines.join('\n\n')}\n\nUse /done TASK_ID, /delay TASK_ID DAYS reason, or /issue TASK_ID description.`,
      );
    }
    if (command === '/ai') {
      const naturalLanguageUpdate = argumentsList.join(' ');
      if (!naturalLanguageUpdate)
        return sendMessage(
          config.groupToken,
          message.chat.id,
          'Usage: <code>/ai describe the update in normal language</code>',
        );
      return interpretNaturalLanguage(message, project, naturalLanguageUpdate);
    }
    if (command === '/done') {
      const task = await store.task(argumentsList[0]);
      if (!task || task.ProjectID !== project.ProjectID)
        return sendMessage(
          config.groupToken,
          message.chat.id,
          'Task not found for this project. Use /tasks to get the task ID.',
        );
      if (!(await verifyAssigned(task, message.from, config.groupToken, message.chat.id))) return;
      return finishTask({ project, task, user, token: config.groupToken, chatId: message.chat.id });
    }
    if (command === '/drawing') {
      const task = await store.task(argumentsList[0]);
      if (!task || task.ProjectID !== project.ProjectID)
        return sendMessage(
          config.groupToken,
          message.chat.id,
          'Task not found for this project. Use /tasks to get the task ID.',
        );
      const drawing = resolveDrawing(await store.revisionsForTask(task.TaskID), 'Client');
      if (!drawing.storageRef)
        return sendMessage(
          config.groupToken,
          message.chat.id,
          `<b>${escape(task.TaskName)}</b>\n${escape(drawing.status)}. ${escape(drawing.nextStep)}`,
        );
      return sendMessage(
        config.groupToken,
        message.chat.id,
        `<b>${escape(task.TaskName)}</b>\nLatest approved file: ${escape(drawing.revision.FileName || drawing.storageRef)}`,
      );
    }
    if (command === '/delay') {
      const [taskId, daysText, ...reasonParts] = argumentsList;
      const days = Number(daysText);
      const reason = reasonParts.join(' ');
      if (!Number.isInteger(days) || days < 1 || !reason)
        return sendMessage(
          config.groupToken,
          message.chat.id,
          'Usage: <code>/delay TASK_ID DAYS reason</code>',
        );
      const task = await store.task(taskId);
      if (!task || task.ProjectID !== project.ProjectID)
        return sendMessage(config.groupToken, message.chat.id, 'Task not found for this project.');
      if (task.Status === 'Completed' || /^(Archived|Cancelled|Closed)/.test(task.Status || ''))
        return sendMessage(
          config.groupToken,
          message.chat.id,
          `<b>${escape(task.TaskName)}</b> is ${escape(task.Status)}, so it cannot be delayed.`,
        );
      if (task.Status === 'Delay Requested')
        return sendMessage(
          config.groupToken,
          message.chat.id,
          `A delay for <b>${escape(task.TaskName)}</b> is already waiting for the founder.`,
        );
      if (!(await verifyAssigned(task, message.from, config.groupToken, message.chat.id))) return;
      return submitDelay({ project, task, user, days, reason, groupChatId: message.chat.id });
    }
    if (command === '/issue') {
      const [taskId, ...issueParts] = argumentsList;
      const issue = issueParts.join(' ');
      if (!issue)
        return sendMessage(
          config.groupToken,
          message.chat.id,
          'Usage: <code>/issue TASK_ID description</code>',
        );
      const task = await store.task(taskId);
      if (!task || task.ProjectID !== project.ProjectID)
        return sendMessage(config.groupToken, message.chat.id, 'Task not found for this project.');
      if (!(await verifyAssigned(task, message.from, config.groupToken, message.chat.id))) return;
      return submitIssue({ project, task, user, issue, groupChatId: message.chat.id });
    }
  }

  async function groupCallback(callback) {
    if (!callback.data.startsWith('ai_')) return;
    const [, action, draftId] = callback.data.split(':');
    const draft = aiDrafts.get(draftId);
    if (!draft || Date.now() - draft.createdAt > 15 * 60 * 1000)
      return answerCallback(
        config.groupToken,
        callback.id,
        'This draft has expired. Please describe the update again.',
      );
    if (String(callback.from.id) !== String(draft.user.id))
      return answerCallback(
        config.groupToken,
        callback.id,
        'Only the person who submitted this update can confirm it.',
      );
    aiDrafts.delete(draftId);
    if (action === 'cancel')
      return answerCallback(config.groupToken, callback.id, 'Cancelled. Nothing changed.');
    if (!(await verifyAssigned(draft.task, callback.from, config.groupToken, draft.groupChatId)))
      return answerCallback(config.groupToken, callback.id, 'You cannot update this task.');
    await answerCallback(config.groupToken, callback.id, 'Update submitted.');
    if (draft.result.action === 'delay')
      return submitDelay({
        project: draft.project,
        task: draft.task,
        user: draft.user,
        days: draft.result.delay_days,
        reason: draft.result.reason,
        groupChatId: draft.groupChatId,
      });
    if (draft.result.action === 'issue')
      return submitIssue({
        project: draft.project,
        task: draft.task,
        user: draft.user,
        issue: draft.result.reason,
        groupChatId: draft.groupChatId,
      });
    if (draft.result.action === 'complete')
      return submitCompletion({
        project: draft.project,
        task: draft.task,
        user: draft.user,
        groupChatId: draft.groupChatId,
      });
  }
  return { requireProject, interpretNaturalLanguage, groupCommand, groupCallback };
}
