import { botConfig } from './config.js';
import crypto from 'node:crypto';
import { aiEnabled, interpretFounderRequest, interpretProjectUpdate } from './ai.js';
import { SheetStore } from './sheets.js';
import { answerCallback, getMe, poll, sendMessage } from './telegram.js';

const config = botConfig();
const store = new SheetStore();
const actor = (from) => ({ id: from.id, name: [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || 'Unknown user' });
const groupOnly = (chat) => ['group', 'supergroup'].includes(chat.type);
const escape = (value) => String(value).replace(/[&<>]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[character]));
const projectCreation = new Map();
const aiDrafts = new Map();
const groupBotProfile = await getMe(config.groupToken);
const leaderBotProfile = await getMe(config.leaderToken);
const groupBotMention = `@${groupBotProfile.username}`.toLowerCase();

console.log(`Project group bot connected as @${groupBotProfile.username}.`);
console.log(`Founder bot connected as @${leaderBotProfile.username}; founder Telegram ID is ${config.founderTelegramId}.`);

const parseDate = (input) => {
  const trimmed = input.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed) && !Number.isNaN(new Date(`${trimmed}T00:00:00Z`).getTime())) return trimmed;
  const withCurrentYear = new Date(`${trimmed} ${new Date().getUTCFullYear()} UTC`);
  return Number.isNaN(withCurrentYear.getTime()) ? null : withCurrentYear.toISOString().slice(0, 10);
};

async function nextProjectId() {
  const projectIds = (await store.rows('Projects')).map((project) => project.ProjectID);
  let number = 1;
  while (projectIds.includes(`P${String(number).padStart(3, '0')}`)) number += 1;
  return `P${String(number).padStart(3, '0')}`;
}

async function showProjects(chatId) {
  const projects = await store.rows('Projects');
  const lines = await Promise.all(projects.map(async (project) => {
    const tasks = await store.tasksForProject(project.ProjectID);
    const completed = tasks.filter((task) => task.Status === 'Completed').length;
    return `• <b>${escape(project.ProjectName)}</b> — ${completed}/${tasks.length} tasks complete · ${escape(project.Status || 'Active')}`;
  }));
  return sendMessage(config.leaderToken, chatId, lines.length ? `<b>Projects</b>\n\n${lines.join('\n')}` : 'No projects exist yet. Say “start a project” whenever you are ready.');
}

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
    return sendMessage(config.leaderToken, chatId, 'What is the start date? You can say “22 September” or write <code>2026-09-22</code>.');
  }
  session.step = 'group';
  const groups = await store.availableGroups();
  if (!groups.length) return sendMessage(config.leaderToken, chatId, 'I have the project details. Add the group bot to the project group, send <code>/start</code> there, then tell me “continue creating the project.”');
  return sendMessage(config.leaderToken, chatId, `Ready to set up <b>${escape(session.projectName)}</b>. Which group should I connect?`, {
    inline_keyboard: groups.slice(0, 10).map((group) => [{ text: group.GroupTitle, callback_data: `create_group:${group.GroupChatID}` }]),
  });
}

async function requireProject(chat, token) {
  if (!groupOnly(chat)) {
    await sendMessage(token, chat.id, 'Please use this command inside the project Telegram group.');
    return null;
  }
  const project = await store.projectForGroup(chat.id);
  if (!project) {
    await store.registerGroup(chat.id, chat.title || 'Unnamed project group');
    await sendMessage(token, chat.id, `This group is registered and ready to link to a project.\nGroup Chat ID: <code>${chat.id}</code>\nOpen the founder bot and use /createproject.`);
  }
  return project;
}

async function verifyAssigned(task, from, token, chatId) {
  const knownUser = await store.user(from.id);
  if (!knownUser && String(from.id) !== config.founderTelegramId) {
    await sendMessage(token, chatId, 'You are not registered as an active project user yet. Ask the founder to add your Telegram ID to the Users sheet.');
    return false;
  }
  if (task.AssignedTelegramID && String(task.AssignedTelegramID) !== String(from.id) && String(from.id) !== config.founderTelegramId) {
    await sendMessage(token, chatId, `Only the assigned team member or the founder can update <code>${task.TaskID}</code>.`);
    return false;
  }
  return true;
}

async function submitDelay({ project, task, user, days, reason, groupChatId }) {
  const approvalId = await store.requestDelay({ project, task, actor: user, days, reason });
  const approverTelegramId = project.LeaderTelegramID || config.founderTelegramId;
  await sendMessage(config.groupToken, groupChatId, `⏳ Delay request sent for approval: <b>${escape(task.TaskName)}</b> — ${days} day(s).`);
  return sendMessage(config.leaderToken, approverTelegramId, `<b>Delay approval needed</b>\n\nProject: ${escape(project.ProjectName)}\nTask: ${escape(task.TaskName)}\nRequested by: ${escape(user.name)}\nDelay: ${days} day(s)\nReason: ${escape(reason)}`, {
    inline_keyboard: [[
      { text: 'Approve', callback_data: `approve:${approvalId}` },
      { text: 'Reject', callback_data: `reject:${approvalId}` },
    ]],
  });
}

async function submitIssue({ project, task, user, issue, groupChatId }) {
  await store.updateRow('Tasks', task.rowNumber, { Status: 'Issue Reported', IssueText: issue, LastUpdatedAt: new Date().toISOString(), LastUpdatedBy: String(user.id) });
  await store.audit({ projectId: project.ProjectID, taskId: task.TaskID, action: 'Issue reported', oldValue: task.Status, newValue: 'Issue Reported', actor: user.id, actorName: user.name, source: 'Telegram group bot', details: issue });
  const recipientTelegramId = project.LeaderTelegramID || config.founderTelegramId;
  await sendMessage(config.groupToken, groupChatId, `⚠️ Issue recorded for <b>${escape(task.TaskName)}</b>. The project lead has been notified.`);
  return sendMessage(config.leaderToken, recipientTelegramId, `⚠️ <b>Issue reported</b>\nProject: ${escape(project.ProjectName)}\nTask: ${escape(task.TaskName)}\nBy: ${escape(user.name)}\n\n${escape(issue)}`);
}

async function submitCompletion({ project, task, user, groupChatId }) {
  await store.updateRow('Tasks', task.rowNumber, { Status: 'Completed', ApprovalStatus: '', LastUpdatedAt: new Date().toISOString(), LastUpdatedBy: String(user.id) });
  await store.audit({ projectId: project.ProjectID, taskId: task.TaskID, action: 'Task completed', oldValue: task.Status, newValue: 'Completed', actor: user.id, actorName: user.name, source: 'Telegram group bot' });
  return sendMessage(config.groupToken, groupChatId, `✅ <b>${escape(task.TaskName)}</b> marked completed by ${escape(user.name)}.`);
}

async function interpretNaturalLanguage(message, project, naturalLanguageUpdate) {
  if (!aiEnabled()) return sendMessage(config.groupToken, message.chat.id, 'AI is not configured yet. The founder needs to add OPENAI_API_KEY to .env and restart the bot.');
  try {
    const result = await interpretProjectUpdate({ project, tasks: await store.tasksForProject(project.ProjectID), message: naturalLanguageUpdate });
    const task = result.task_id ? await store.task(result.task_id) : null;
    if (!task || !['delay', 'issue', 'complete'].includes(result.action)) {
      return sendMessage(config.groupToken, message.chat.id, result.clarification_question || 'I could not identify a safe project action. Please tell me which task you mean.');
    }
    const requiresDetails = (result.action === 'delay' && (!result.delay_days || !result.reason)) || (result.action === 'issue' && !result.reason);
    if (requiresDetails) return sendMessage(config.groupToken, message.chat.id, result.clarification_question || 'I need the delay duration or issue details before I can draft that update.');
    const draftId = crypto.randomUUID().slice(0, 12);
    aiDrafts.set(draftId, { project, task, result, user: actor(message.from), groupChatId: message.chat.id, createdAt: Date.now() });
    const label = result.action === 'delay' ? `Delay: ${result.delay_days} day(s)` : result.action === 'issue' ? 'Issue report' : 'Mark completed';
    const detail = result.reason ? `\nReason: ${escape(result.reason)}` : '';
    return sendMessage(config.groupToken, message.chat.id, `🤖 <b>Proposed update</b>\nTask: <b>${escape(task.TaskName)}</b>\nAction: ${label}${detail}\n\nWould you like me to submit this?`, {
      inline_keyboard: [[
        { text: 'Confirm', callback_data: `ai_confirm:${draftId}` },
        { text: 'Cancel', callback_data: `ai_cancel:${draftId}` },
      ]],
    });
  } catch (error) {
    console.error('AI interpretation error:', error.message);
    return sendMessage(config.groupToken, message.chat.id, 'I could not interpret that update right now. Please try again or use /delay, /issue, or /done.');
  }
}

async function groupCommand(message) {
  const text = message.text?.trim() ?? '';
  const [rawCommand, ...argumentsList] = text.split(/\s+/);
  const command = rawCommand?.split('@')[0];
  const project = await requireProject(message.chat, config.groupToken);
  if (!project) return;
  const user = actor(message.from);

  if (command === '/start') {
    await sendMessage(config.groupToken, message.chat.id, `Connected to <b>${escape(project.ProjectName)}</b>.\nUse /tasks to see active work.`, null);
    return;
  }
  if (command === '/tasks') {
    const tasks = (await store.tasksForProject(project.ProjectID)).filter((task) => !['Completed', 'Archived'].includes(task.Status));
    if (!tasks.length) return sendMessage(config.groupToken, message.chat.id, 'No active tasks are currently recorded for this project.');
    const lines = tasks.slice(0, 12).map((task) => `• <code>${task.TaskID}</code> — <b>${escape(task.TaskName)}</b>\n  ${escape(task.Status || 'Pending')} · ${escape(task.AssignedName || task.AssignedRole || 'Unassigned')} · ${escape(task.CurrentEnd || task.PlannedEnd || 'No date')}`);
    return sendMessage(config.groupToken, message.chat.id, `<b>${escape(project.ProjectName)} — active tasks</b>\n\n${lines.join('\n\n')}\n\nUse /done TASK_ID, /delay TASK_ID DAYS reason, or /issue TASK_ID description.`);
  }
  if (command === '/ai') {
    const naturalLanguageUpdate = argumentsList.join(' ');
    if (!naturalLanguageUpdate) return sendMessage(config.groupToken, message.chat.id, 'Usage: <code>/ai describe the update in normal language</code>');
    return interpretNaturalLanguage(message, project, naturalLanguageUpdate);
  }
  if (command === '/done') {
    const task = await store.task(argumentsList[0]);
    if (!task || task.ProjectID !== project.ProjectID) return sendMessage(config.groupToken, message.chat.id, 'Task not found for this project. Use /tasks to get the task ID.');
    if (!(await verifyAssigned(task, message.from, config.groupToken, message.chat.id))) return;
    await store.updateRow('Tasks', task.rowNumber, { Status: 'Completed', ApprovalStatus: '', LastUpdatedAt: new Date().toISOString(), LastUpdatedBy: String(user.id) });
    await store.audit({ projectId: project.ProjectID, taskId: task.TaskID, action: 'Task completed', oldValue: task.Status, newValue: 'Completed', actor: user.id, actorName: user.name, source: 'Telegram group bot' });
    return sendMessage(config.groupToken, message.chat.id, `✅ <b>${escape(task.TaskName)}</b> marked completed by ${escape(user.name)}.`);
  }
  if (command === '/delay') {
    const [taskId, daysText, ...reasonParts] = argumentsList;
    const days = Number(daysText);
    const reason = reasonParts.join(' ');
    if (!Number.isInteger(days) || days < 1 || !reason) return sendMessage(config.groupToken, message.chat.id, 'Usage: <code>/delay TASK_ID DAYS reason</code>');
    const task = await store.task(taskId);
    if (!task || task.ProjectID !== project.ProjectID) return sendMessage(config.groupToken, message.chat.id, 'Task not found for this project.');
    if (!(await verifyAssigned(task, message.from, config.groupToken, message.chat.id))) return;
    return submitDelay({ project, task, user, days, reason, groupChatId: message.chat.id });
  }
  if (command === '/issue') {
    const [taskId, ...issueParts] = argumentsList;
    const issue = issueParts.join(' ');
    if (!issue) return sendMessage(config.groupToken, message.chat.id, 'Usage: <code>/issue TASK_ID description</code>');
    const task = await store.task(taskId);
    if (!task || task.ProjectID !== project.ProjectID) return sendMessage(config.groupToken, message.chat.id, 'Task not found for this project.');
    if (!(await verifyAssigned(task, message.from, config.groupToken, message.chat.id))) return;
    return submitIssue({ project, task, user, issue, groupChatId: message.chat.id });
  }
}

async function leaderCommand(message) {
  if (String(message.from.id) !== config.founderTelegramId) {
    console.warn(`Ignoring founder-bot message from unauthorized Telegram ID ${message.from.id}.`);
    return;
  }
  console.log(`Founder bot received ${message.text?.trim().split(/\s+/)[0] || 'a message'} from the configured founder.`);
  const command = message.text?.trim().split(/\s+/)[0]?.split('@')[0];
  if (command === '/start' || command === '/help') return sendMessage(config.leaderToken, message.chat.id, `<b>Founder bot commands</b>\n\n/createproject — create a project and generate its 15-step plan\n/projects — list projects and progress\n/project P001 — view one project\n/adduser ID | Name | Role — register a team member\n/approvals — review pending requests\n/cancel — cancel the current project-creation flow`);
  if (command === '/cancel') {
    projectCreation.delete(message.chat.id);
    return sendMessage(config.leaderToken, message.chat.id, 'Cancelled.');
  }
  if (command === '/createproject' || command === '/newproject') {
    return continueProjectCreation(message.chat.id, {});
  }
  if (command === '/project') {
    const projectId = message.text.trim().split(/\s+/)[1];
    if (!projectId) return sendMessage(config.leaderToken, message.chat.id, 'Usage: <code>/project P001</code>');
    const project = await store.projectById(projectId);
    if (!project) return sendMessage(config.leaderToken, message.chat.id, 'Project not found.');
    const tasks = await store.tasksForProject(projectId);
    const completed = tasks.filter((task) => task.Status === 'Completed').length;
    const delayed = tasks.filter((task) => task.Status.includes('Delay') || task.Status.includes('Delayed')).length;
    return sendMessage(config.leaderToken, message.chat.id, `<b>${escape(project.ProjectName)}</b> (<code>${escape(project.ProjectID)}</code>)\nClient: ${escape(project.ClientName)}\nStatus: ${escape(project.Status)}\nProgress: ${completed}/${tasks.length} complete\nDelays: ${delayed}\nTarget end: ${escape(project.TargetEndDate || 'Not set')}`);
  }
  if (command === '/adduser') {
    const raw = message.text.slice(message.text.indexOf(' ') + 1);
    const [telegramId, name, role] = raw.split('|').map((part) => part?.trim());
    if (!telegramId || !name || !role) return sendMessage(config.leaderToken, message.chat.id, 'Usage: <code>/adduser TELEGRAM_ID | Name | Role</code>');
    const existing = await store.user(telegramId);
    if (existing) await store.updateRow('Users', existing.rowNumber, { Name: name, Role: role, Active: 'Yes' });
    else await store.append('Users', { TelegramUserID: telegramId, Name: name, Role: role, Active: 'Yes' });
    return sendMessage(config.leaderToken, message.chat.id, `✅ Registered <b>${escape(name)}</b> as ${escape(role)}.`);
  }
  if (command === '/projects') {
    return showProjects(message.chat.id);
  }
  if (command === '/approvals') {
    const approvals = await store.approvals();
    const lines = approvals.map((item) => `• <code>${item.ApprovalID}</code> — ${escape(item.RequestType)} for <code>${item.TaskID}</code>: ${escape(item.Reason)}`);
    return sendMessage(config.leaderToken, message.chat.id, lines.length ? `<b>Pending approvals</b>\n\n${lines.join('\n')}` : 'No pending approvals.');
  }
}

async function groupCallback(callback) {
  if (!callback.data.startsWith('ai_')) return;
  const [, action, draftId] = callback.data.split(':');
  const draft = aiDrafts.get(draftId);
  if (!draft || Date.now() - draft.createdAt > 15 * 60 * 1000) return answerCallback(config.groupToken, callback.id, 'This draft has expired. Please describe the update again.');
  if (String(callback.from.id) !== String(draft.user.id)) return answerCallback(config.groupToken, callback.id, 'Only the person who submitted this update can confirm it.');
  aiDrafts.delete(draftId);
  if (action === 'cancel') return answerCallback(config.groupToken, callback.id, 'Cancelled. Nothing changed.');
  if (!(await verifyAssigned(draft.task, callback.from, config.groupToken, draft.groupChatId))) return answerCallback(config.groupToken, callback.id, 'You cannot update this task.');
  await answerCallback(config.groupToken, callback.id, 'Update submitted.');
  if (draft.result.action === 'delay') return submitDelay({ project: draft.project, task: draft.task, user: draft.user, days: draft.result.delay_days, reason: draft.result.reason, groupChatId: draft.groupChatId });
  if (draft.result.action === 'issue') return submitIssue({ project: draft.project, task: draft.task, user: draft.user, issue: draft.result.reason, groupChatId: draft.groupChatId });
  if (draft.result.action === 'complete') return submitCompletion({ project: draft.project, task: draft.task, user: draft.user, groupChatId: draft.groupChatId });
}

async function leaderCreationReply(message) {
  if (String(message.from.id) !== config.founderTelegramId) return;
  const session = projectCreation.get(message.chat.id);
  if (!session || message.text?.startsWith('/')) return;
  const reply = message.text.trim();
  if (session.step === 'group') return continueProjectCreation(message.chat.id, session);
  if (session.step === 'name') {
    session.projectName = reply; session.step = 'client';
    return sendMessage(config.leaderToken, message.chat.id, 'Who is the <b>client</b>?');
  }
  if (session.step === 'client') {
    session.clientName = reply; session.step = 'date';
    return sendMessage(config.leaderToken, message.chat.id, 'What is the <b>start date</b>? You can write <code>2026-09-20</code> or <code>20 September</code>.');
  }
  if (session.step === 'date') {
    const parsedDate = parseDate(reply);
    if (!parsedDate) return sendMessage(config.leaderToken, message.chat.id, 'I could not read that date. Try <code>2026-09-20</code>.');
    session.startDateText = parsedDate;
    return continueProjectCreation(message.chat.id, session);
  }
}

async function leaderNaturalLanguageReply(message) {
  if (String(message.from.id) !== config.founderTelegramId) return;
  const session = projectCreation.get(message.chat.id);
  if (session) return leaderCreationReply(message);
  if (!aiEnabled()) return sendMessage(config.leaderToken, message.chat.id, 'I can help with projects, but AI is not configured yet. You can still use /help.');
  try {
    const result = await interpretFounderRequest(message.text.trim());
    if (result.intent === 'start_project') {
      return continueProjectCreation(message.chat.id, {
        projectName: result.project_name || '', clientName: result.client_name || '', startDateText: parseDate(result.start_date) || '',
      });
    }
    if (result.intent === 'list_projects') return showProjects(message.chat.id);
    if (result.intent === 'project_status' && result.project_id) {
      return leaderCommand({ ...message, text: `/project ${result.project_id}` });
    }
    return sendMessage(config.leaderToken, message.chat.id, result.reply || 'I can start a project, list projects, or check a project status. What would you like to do?');
  } catch (error) {
    console.error('Founder AI interpretation error:', error.message);
    return sendMessage(config.leaderToken, message.chat.id, 'I could not understand that just now. Please try again, or use /help.');
  }
}

async function leaderCallback(callback) {
  if (callback.data.startsWith('create_group:')) {
    if (String(callback.from.id) !== config.founderTelegramId) return answerCallback(config.leaderToken, callback.id, 'Only the founder can create a project.');
    const session = projectCreation.get(callback.message.chat.id);
    if (!session || session.step !== 'group') return answerCallback(config.leaderToken, callback.id, 'Project creation session expired. Start /createproject again.');
    const groupChatId = callback.data.slice('create_group:'.length);
    try {
      const projectId = await nextProjectId();
      const { createProjectFromHouseWorkflow } = await import('./project-service.js');
      const result = await createProjectFromHouseWorkflow({
        store, projectId, projectName: session.projectName, clientName: session.clientName,
        startDateText: session.startDateText, groupChatId, leaderTelegramId: config.founderTelegramId,
      });
      projectCreation.delete(callback.message.chat.id);
      await answerCallback(config.leaderToken, callback.id, 'Project created.');
      await sendMessage(config.leaderToken, callback.message.chat.id, `✅ <b>${escape(session.projectName)}</b> created as <code>${projectId}</code>.\n${result.taskCount} tasks generated.\nPlanned finish: ${result.targetEndDate}`);
      return sendMessage(config.groupToken, groupChatId, `🏠 <b>${escape(session.projectName)}</b> is now connected.\n${result.taskCount} tasks have been generated. Use /tasks to view the plan.`);
    } catch (error) {
      console.error('Project creation error:', error.message);
      return answerCallback(config.leaderToken, callback.id, 'Could not create project. Check the logs.');
    }
  }
  const [decision, approvalId] = callback.data.split(':');
  const approval = (await store.approvals()).find((item) => item.ApprovalID === approvalId);
  if (!approval) return answerCallback(config.leaderToken, callback.id, 'Approval is no longer pending.');
  const project = await store.projectById(approval.ProjectID);
  const isFounder = String(callback.from.id) === config.founderTelegramId;
  const isProjectLead = project && String(callback.from.id) === String(project.LeaderTelegramID);
  if (!isFounder && !isProjectLead) return answerCallback(config.leaderToken, callback.id, 'Only the founder or project lead can decide.');
  const task = await store.task(approval.TaskID);
  const status = decision === 'approve' ? 'Approved' : 'Rejected';
  await store.updateRow('Approvals', approval.rowNumber, { Status: status, DecidedAt: new Date().toISOString(), DecidedByTelegramID: String(callback.from.id) });
  await store.updateRow('Tasks', task.rowNumber, { Status: decision === 'approve' ? 'Delayed — Approved' : 'Delay Rejected', ApprovalStatus: status, LastUpdatedAt: new Date().toISOString(), LastUpdatedBy: String(callback.from.id) });
  await store.audit({ projectId: approval.ProjectID, taskId: task.TaskID, action: `Delay ${status.toLowerCase()}`, oldValue: 'Delay Requested', newValue: status, actor: callback.from.id, actorName: actor(callback.from).name, source: 'Telegram leader bot', details: approval.Reason });
  await answerCallback(config.leaderToken, callback.id, `Delay ${status.toLowerCase()}.`);
  await sendMessage(config.leaderToken, callback.message.chat.id, `✅ Delay request <code>${approvalId}</code> ${status.toLowerCase()}.`);
  return sendMessage(config.groupToken, approval.GroupChatID, `${decision === 'approve' ? '✅' : '❌'} The founder ${status.toLowerCase()} the delay for <b>${escape(task.TaskName)}</b>.\nReason: ${escape(approval.Reason)}`);
}

poll(config.groupToken, 'Project group bot', async (update) => {
  if (update.message?.text?.startsWith('/')) await groupCommand(update.message);
  else if (update.message?.text) {
    const text = update.message.text.trim();
    const isMention = text.toLowerCase().includes(groupBotMention);
    const isReplyToBot = update.message.reply_to_message?.from?.username === groupBotProfile.username;
    if (isMention || isReplyToBot) {
      const project = await requireProject(update.message.chat, config.groupToken);
      const naturalLanguageUpdate = text.replaceAll(new RegExp(groupBotMention.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '').trim();
      if (project && naturalLanguageUpdate) await interpretNaturalLanguage(update.message, project, naturalLanguageUpdate);
    }
  }
  if (update.callback_query) await groupCallback(update.callback_query);
});
poll(config.leaderToken, 'Founder bot', async (update) => {
  if (update.message?.text?.startsWith('/')) await leaderCommand(update.message);
  else if (update.message?.text) await leaderNaturalLanguageReply(update.message);
  if (update.callback_query) await leaderCallback(update.callback_query);
});
