import { botConfig } from './config.js';
import crypto from 'node:crypto';
import { aiEnabled, chatWithFounder, interpretFounderGroupMessage, interpretProjectUpdate } from './ai.js';
import { SheetStore } from './sheets.js';
import { WORKFLOW_OPTIONS } from './schema.js';
import { answerCallback, getChatMember, getMe, poll, sendDocument, sendMessage, sendPhoto } from './telegram.js';

const config = botConfig();
const store = new SheetStore();
const actor = (from) => ({ id: from.id, name: [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || 'Unknown user' });
const groupOnly = (chat) => ['group', 'supergroup'].includes(chat.type);
const escape = (value) => String(value).replace(/[&<>]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[character]));
const projectCreation = new Map();
const aiDrafts = new Map();
const founderRoleAssignments = new Map();
const founderConversation = new Map();
const founderGroupMessageDrafts = new Map();
const groupBotProfile = await getMe(config.groupToken);
const leaderBotProfile = await getMe(config.leaderToken);
const groupBotMention = `@${groupBotProfile.username}`.toLowerCase();

function founderHistory(chatId) {
  return founderConversation.get(String(chatId)) ?? [];
}

function rememberFounderConversation(chatId, role, content) {
  const entries = [...founderHistory(chatId), { role, content: String(content).slice(0, 1_200) }].slice(-8);
  founderConversation.set(String(chatId), entries);
}

async function founderProjectContext() {
  const projects = await store.rows('Projects');
  return Promise.all(projects.slice(-12).map(async (project) => {
    const tasks = await store.tasksForProject(project.ProjectID);
    const current = tasks.find((task) => !['Completed', 'Archived'].includes(task.Status));
    return {
      id: project.ProjectID,
      name: project.ProjectName,
      client: project.ClientName,
      status: project.Status,
      progress: `${tasks.filter((task) => task.Status === 'Completed').length}/${tasks.length}`,
      current_task: current?.TaskName || 'All planned tasks complete',
      current_stage: current?.Stage || 'Handover',
      target_end: project.TargetEndDate || '',
    };
  }));
}

async function founderChatReply(message) {
  const chatId = message.chat.id;
  const text = message.text.trim();
  const reply = await chatWithFounder({
    message: text,
    history: founderHistory(chatId),
    projects: await founderProjectContext(),
  });
  rememberFounderConversation(chatId, 'user', text);
  rememberFounderConversation(chatId, 'assistant', reply);
  return sendMessage(config.leaderToken, chatId, escape(reply));
}

async function draftFounderGroupMessage(message) {
  const projects = (await store.rows('Projects')).filter((project) => project.GroupChatID && !['Completed', 'Abandoned'].includes(project.Status));
  const interpreted = await interpretFounderGroupMessage({
    message: message.text.trim(),
    projects: projects.map((project) => ({ id: project.ProjectID, name: project.ProjectName, client: project.ClientName })),
  });
  if (interpreted.intent !== 'send_group_message') return false;
  const project = projects.find((item) => item.ProjectID === interpreted.project_id);
  if (!project) {
    const choices = projects.map((item) => `• ${escape(item.ProjectName)} (<code>${escape(item.ProjectID)}</code>)`).join('\n');
    await sendMessage(config.leaderToken, message.chat.id, `${escape(interpreted.clarification_question || 'Which project group should I send this to?')}\n\n${choices || 'No active project groups are linked yet.'}`);
    return true;
  }
  const text = String(interpreted.message_text || '').trim();
  if (!text || text.length > 3_500) {
    await sendMessage(config.leaderToken, message.chat.id, 'I could not prepare a short group message. Please tell me what you want the client or team to hear.');
    return true;
  }
  const draftId = crypto.randomUUID();
  founderGroupMessageDrafts.set(draftId, { projectId: project.ProjectID, text, createdAt: Date.now() });
  await sendMessage(config.leaderToken, message.chat.id, `<b>Ready to send to ${escape(project.ProjectName)}</b>\n\n${escape(text)}\n\nTap Send to post this in the linked Telegram group.`, {
    inline_keyboard: [[
      { text: `Send to ${project.ProjectName}`.slice(0, 55), callback_data: `group_send:${draftId}` },
      { text: 'Cancel', callback_data: `group_cancel:${draftId}` },
    ]],
  });
  return true;
}

console.log(`Project group bot connected as @${groupBotProfile.username}.`);
console.log(`Founder bot connected as @${leaderBotProfile.username}; founder Telegram ID is ${config.founderTelegramId}.`);
await store.ensureSchema();
await store.seedDefaultWorkflows();

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

async function projectTldr(project) {
  const tasks = (await store.tasksForProject(project.ProjectID)).sort((left, right) => Number(left.Sequence) - Number(right.Sequence));
  const completed = tasks.filter((task) => task.Status === 'Completed').length;
  const current = tasks.find((task) => !['Completed', 'Archived'].includes(task.Status));
  const issues = tasks.filter((task) => task.Status === 'Issue Reported').length;
  const delays = tasks.filter((task) => task.Status.includes('Delay')).length;
  const approvals = (await store.approvals()).filter((item) => item.ProjectID === project.ProjectID).length;
  const blockers = [issues ? `${issues} reported issue${issues === 1 ? '' : 's'}` : '', delays ? `${delays} delay${delays === 1 ? '' : 's'}` : '', approvals ? `${approvals} approval${approvals === 1 ? '' : 's'} pending` : ''].filter(Boolean);
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
  return stages.map((stage) => `• ${escape(stage.name)} — ${stage.count} task${stage.count === 1 ? '' : 's'}`).join('\n');
}

async function shareWorkflowResources(project, workflowId) {
  const resources = await store.resourcesForWorkflow(workflowId);
  for (const resource of resources) {
    const caption = `<b>${escape(resource.Title)}</b>${resource.Description ? `\n${escape(resource.Description)}` : ''}`;
    try {
      if (resource.ResourceType.toLowerCase() === 'photo') await sendPhoto(config.groupToken, project.GroupChatID, resource.UrlOrFileId, caption);
      else if (resource.ResourceType.toLowerCase() === 'document') await sendDocument(config.groupToken, project.GroupChatID, resource.UrlOrFileId, caption);
      else await sendMessage(config.groupToken, project.GroupChatID, `${caption}\n${escape(resource.UrlOrFileId)}`);
    } catch (error) {
      console.error(`Could not share resource ${resource.ResourceID}:`, error.message);
    }
  }
}

async function requestClientResources(project, workflow) {
  const resourceTask = workflow.find((task) => task.Stage === 'Resources');
  if (!resourceTask) return;
  await sendMessage(config.groupToken, project.GroupChatID, `<b>First step — project resources</b>\n\nHi <b>${escape(project.ClientName || 'there')}</b> 👋 Please share all relevant project material here so we can begin: plans, drawings, photos, measurements, approvals, reference images, and existing documents.\n\nThis is the first task in the <b>${escape(project.ProjectName)}</b> workflow. You can send files and photos directly in this group; I’ll log them for the project team.`);
}

async function handleProjectResourceUpload(message) {
  if (!groupOnly(message.chat) || (!message.document && !message.photo?.length)) return;
  const project = await store.projectForGroup(message.chat.id);
  if (!project || ['Completed', 'Abandoned'].includes(project.Status)) return;
  const user = actor(message.from);
  const knownUser = await store.user(message.from.id);
  const maySubmit = String(message.from.id) === config.founderTelegramId || /\bclient\b/i.test(knownUser?.Role || '');
  if (!maySubmit) return;
  const task = (await store.tasksForProject(project.ProjectID)).find((item) => item.Stage === 'Resources' && item.Status !== 'Completed');
  if (!task) return;
  const document = message.document;
  const photo = message.photo?.at(-1);
  const resourceType = document ? 'Document' : 'Photo';
  const fileId = document?.file_id || photo?.file_id;
  const fileName = document?.file_name || `photo-${message.message_id}`;
  await store.saveSubmittedResource({
    projectId: project.ProjectID, taskId: task.TaskID, groupChatId: message.chat.id, user,
    resourceType, fileId, fileName, caption: message.caption || '',
  });
  await store.updateRow('Tasks', task.rowNumber, {
    Status: 'Resources received — Review needed',
    LastUpdatedAt: new Date().toISOString(),
    LastUpdatedBy: String(user.id),
  });
  await store.audit({ projectId: project.ProjectID, taskId: task.TaskID, action: 'Project resource submitted', oldValue: task.Status, newValue: 'Resources received — Review needed', actor: user.id, actorName: user.name, source: 'Telegram group bot', details: `${resourceType}: ${fileName}` });
  await sendMessage(config.groupToken, message.chat.id, `✅ Thanks ${escape(user.name)} — I logged this ${resourceType.toLowerCase()} under the project resources. The founder can review it before moving to the next step.`);
  return sendMessage(config.leaderToken, project.LeaderTelegramID || config.founderTelegramId, `📎 <b>Project resource received</b>\n\nProject: ${escape(project.ProjectName)}\nFrom: ${escape(user.name)}\nFile: ${escape(fileName)}\n\nThe Resources task is ready for your review.`);
}

function isUntouchedLegacyPlan(project, tasks) {
  return project.Notes === 'Pilot project generated from HOUSE-V1.' && tasks.length > 0 && tasks.every((task) => task.WorkflowID === 'HOUSE-V1' && task.Status === 'Pending');
}

async function askFounderForPlan({ project, clientName, replaceUntouchedLegacyPlan = false }) {
  const legacyNote = replaceUntouchedLegacyPlan ? '\n\nThis project has an untouched legacy house plan. Choosing an option will archive those unused task records and generate the selected plan; nothing is deleted.' : '';
  return sendMessage(config.leaderToken, config.founderTelegramId, `<b>Client profile complete</b>\n\n${escape(clientName)} is now marked as the client for <b>${escape(project.ProjectName)}</b>. Which plan should we assign?\n\nThe selected plan will generate the project tasks and share its linked resources with the group.${legacyNote}`, {
    inline_keyboard: WORKFLOW_OPTIONS.map((option) => [{ text: option.label, callback_data: `choose_plan:${project.ProjectID}:${option.id}` }]),
  });
}

// Telegram reports a group owner's status as "creator". Include it so founder
// departures are detected just like administrator or member departures.
const joinedStatus = new Set(['creator', 'owner', 'member', 'administrator', 'restricted']);

async function recoverFounderDepartureAlerts() {
  const auditEntries = await store.rows('AuditLog');
  const projects = (await store.rows('Projects')).filter((project) => !['Completed', 'Abandoned'].includes(project.Status));
  for (const project of projects) {
    if (auditEntries.some((entry) => entry.ProjectID === project.ProjectID && entry.Action === 'Founder left project group')) continue;
    try {
      const member = await getChatMember(config.groupToken, project.GroupChatID, config.founderTelegramId);
      if (joinedStatus.has(member.status)) continue;
      await store.audit({
        projectId: project.ProjectID,
        action: 'Founder left project group',
        oldValue: 'Unknown',
        newValue: member.status,
        actor: config.founderTelegramId,
        actorName: 'Founder',
        source: 'Startup membership check',
        details: 'Founder absence detected after a restart; awaiting closure decision. No project data changed.',
      });
      await sendMessage(config.leaderToken, config.founderTelegramId, `<b>You are no longer in ${escape(project.ProjectName)}</b>\n\nShould I close this project as completed or abandoned? Nothing will be deleted either way.`, {
        inline_keyboard: [[
          { text: 'Mark completed', callback_data: `close_project:${project.ProjectID}:completed` },
          { text: 'Mark abandoned', callback_data: `close_project:${project.ProjectID}:abandoned` },
        ], [{ text: 'I left by accident — keep active', callback_data: `close_project:${project.ProjectID}:keep_active` }]],
      });
    } catch (error) {
      console.warn(`Could not check founder membership for ${project.ProjectID}:`, error.message);
    }
  }
}

await recoverFounderDepartureAlerts();

async function welcomeNewProjectMember(update) {
  const change = update.chat_member;
  if (!change || !groupOnly(change.chat)) return;
  const oldStatus = change.old_chat_member?.status;
  const newStatus = change.new_chat_member?.status;
  const member = change.new_chat_member?.user;
  if (!member || member.is_bot || joinedStatus.has(oldStatus) || !joinedStatus.has(newStatus)) return;
  const project = await store.projectForGroup(change.chat.id);
  if (!project || await store.onboardingForMember(project.ProjectID, member.id)) return;
  const onboardingId = `ONB-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const memberName = actor(member).name;
  await store.createOnboarding({ onboardingId, projectId: project.ProjectID, groupChatId: change.chat.id, telegramId: member.id, telegramName: memberName });
  await store.audit({ projectId: project.ProjectID, action: 'Member joined — pending profile', actor: member.id, actorName: memberName, source: 'Telegram group bot', details: onboardingId });
  const profileLink = `https://t.me/${leaderBotProfile.username}?start=profile_${onboardingId}`;
  await sendMessage(config.groupToken, change.chat.id, `Welcome <b>${escape(memberName)}</b> 👋\n\nI’m setting up your project profile. Meanwhile, here is where the project stands:\n\n${await projectTldr(project)}\n\nThe founder will confirm your role shortly.`, { inline_keyboard: [[{ text: 'Set up my profile', url: profileLink }]] });
  return sendMessage(config.leaderToken, config.founderTelegramId, `<b>New project member joined</b>\n\nName: ${escape(memberName)}\nProject: ${escape(project.ProjectName)}\nJoined: ${new Date(change.date * 1000).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}\n\nPlease assign their profile and role before they can update project tasks.`, { inline_keyboard: [[{ text: 'Assign role', callback_data: `onboard_role:${onboardingId}` }]] });
}

async function handleFounderGroupDeparture(update) {
  const change = update.chat_member;
  if (!change || !groupOnly(change.chat)) return;
  const member = change.new_chat_member?.user;
  const oldStatus = change.old_chat_member?.status;
  const newStatus = change.new_chat_member?.status;
  if (!member || String(member.id) !== config.founderTelegramId || !joinedStatus.has(oldStatus) || !['left', 'kicked'].includes(newStatus)) return;
  const project = await store.projectForGroup(change.chat.id);
  if (!project || ['Completed', 'Abandoned'].includes(project.Status)) return;
  await store.audit({
    projectId: project.ProjectID,
    action: 'Founder left project group',
    oldValue: oldStatus,
    newValue: newStatus,
    actor: member.id,
    actorName: actor(member).name,
    source: 'Telegram group bot',
    details: 'Awaiting founder closure decision; no project data changed.',
  });
  return sendMessage(config.leaderToken, config.founderTelegramId, `<b>You left ${escape(project.ProjectName)}</b>\n\nShould I close this project as completed or abandoned? Nothing will be deleted either way.`, {
    inline_keyboard: [[
      { text: 'Mark completed', callback_data: `close_project:${project.ProjectID}:completed` },
      { text: 'Mark abandoned', callback_data: `close_project:${project.ProjectID}:abandoned` },
    ], [{ text: 'I left by accident — keep active', callback_data: `close_project:${project.ProjectID}:keep_active` }]],
  });
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

async function changeUserRole(chatId, user, role) {
  await store.updateRow('Users', user.rowNumber, { Role: role, Active: 'Yes' });
  return sendMessage(config.leaderToken, chatId, `✅ Updated <b>${escape(user.Name)}</b> to <b>${escape(role)}</b>.`);
}

async function changeRoleByName(chatId, name, role) {
  const normalizedName = name.trim().toLowerCase();
  const matches = (await store.activeUsers()).filter((user) => user.Name.toLowerCase() === normalizedName || user.Name.toLowerCase().includes(normalizedName));
  if (matches.length === 1) return changeUserRole(chatId, matches[0], role);
  if (matches.length > 1) return sendMessage(config.leaderToken, chatId, `I found more than one active member matching “${escape(name)}”. Use <code>/role TELEGRAM_ID | New role</code> instead.`);
  return sendMessage(config.leaderToken, chatId, `I could not find an active member named “${escape(name)}”. Use <code>/role TELEGRAM_ID | New role</code> instead.`);
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
    return null;
  }
  if (['Completed', 'Abandoned'].includes(project.Status)) {
    await sendMessage(token, chat.id, `This project is <b>${escape(project.Status.toLowerCase())}</b>. Its history is retained, but task updates are closed.`);
    return null;
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
  const command = message.text?.trim().split(/\s+/)[0]?.split('@')[0];
  const startPayload = message.text?.trim().split(/\s+/)[1] || '';
  if (String(message.from.id) !== config.founderTelegramId) {
    if (command === '/start' && startPayload.startsWith('profile_')) {
      const onboarding = await store.onboarding(startPayload.slice('profile_'.length));
      if (onboarding && String(onboarding.TelegramUserID) === String(message.from.id)) return sendMessage(config.leaderToken, message.chat.id, 'Thanks — the founder has been notified and will confirm your project role shortly.');
    }
    console.warn(`Ignoring founder-bot message from unauthorized Telegram ID ${message.from.id}.`);
    return;
  }
  console.log(`Founder bot received ${message.text?.trim().split(/\s+/)[0] || 'a message'} from the configured founder.`);
  if (command === '/start' || command === '/help') return sendMessage(config.leaderToken, message.chat.id, `<b>Founder bot commands</b>\n\n/createproject — create a project shell\n/plan P001 — choose a plan for a waiting or untouched legacy project\n/projects — list projects and progress\n/project P001 — view one project\n/adduser ID | Name | Role — register a team member\n/approvals — review pending requests\n/cancel — cancel the current project-creation flow`);
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
  if (command === '/plan') {
    const projectId = message.text.trim().split(/\s+/)[1];
    if (!projectId) return sendMessage(config.leaderToken, message.chat.id, 'Usage: <code>/plan P001</code>');
    const project = await store.projectById(projectId);
    if (!project) return sendMessage(config.leaderToken, message.chat.id, 'Project not found.');
    const tasks = await store.tasksForProject(projectId);
    const legacyPlan = isUntouchedLegacyPlan(project, tasks);
    if (tasks.length && !legacyPlan) return sendMessage(config.leaderToken, message.chat.id, 'This project already has active work, so its plan cannot be replaced automatically.');
    return askFounderForPlan({ project, clientName: project.ClientName || 'The client', replaceUntouchedLegacyPlan: legacyPlan });
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
  if (command === '/role') {
    const raw = message.text.slice(message.text.indexOf(' ') + 1);
    const [telegramId, role] = raw.split('|').map((part) => part?.trim());
    const user = telegramId && await store.user(telegramId);
    if (!user || !role) return sendMessage(config.leaderToken, message.chat.id, 'Usage: <code>/role TELEGRAM_ID | New role</code>');
    return changeUserRole(message.chat.id, user, role);
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
  const onboardingId = founderRoleAssignments.get(message.chat.id);
  if (onboardingId) {
    const [name, role] = message.text.split('|').map((part) => part?.trim());
    if (!name || !role) return sendMessage(config.leaderToken, message.chat.id, 'Please use <code>Full name | Role</code>, for example <code>Rahul Sharma | Electrical contractor</code>.');
    const onboarding = await store.onboarding(onboardingId);
    if (!onboarding || onboarding.Status !== 'Pending') {
      founderRoleAssignments.delete(message.chat.id);
      return sendMessage(config.leaderToken, message.chat.id, 'That member profile is no longer pending.');
    }
    await store.approveOnboarding(onboarding, { name, role, founderTelegramId: config.founderTelegramId });
    await store.audit({ projectId: onboarding.ProjectID, action: 'Member profile approved', actor: config.founderTelegramId, actorName: 'Founder', source: 'Telegram founder bot', details: `${name} | ${role}` });
    founderRoleAssignments.delete(message.chat.id);
    await sendMessage(config.groupToken, onboarding.GroupChatID, `✅ <b>${escape(name)}</b> is now active on this project as <b>${escape(role)}</b>.`);
    try { await sendMessage(config.leaderToken, onboarding.TelegramUserID, `Your project profile is active. Role: <b>${escape(role)}</b>.`); } catch { console.log('New member has not started the founder bot yet.'); }
    const project = await store.projectById(onboarding.ProjectID);
    const projectTasks = project ? await store.tasksForProject(project.ProjectID) : [];
    const legacyPlan = project && isUntouchedLegacyPlan(project, projectTasks);
    if (project && /\bclient\b/i.test(role) && (!projectTasks.length || legacyPlan)) {
      await store.updateRow('Projects', project.rowNumber, { ClientName: name });
      project.ClientName = name;
      await askFounderForPlan({ project, clientName: name, replaceUntouchedLegacyPlan: legacyPlan });
      return sendMessage(config.leaderToken, message.chat.id, `✅ ${escape(name)} is now active as ${escape(role)}. I’ve also asked which workflow to assign.`);
    }
    return sendMessage(config.leaderToken, message.chat.id, `✅ ${escape(name)} is now active as ${escape(role)}.`);
  }
  const session = projectCreation.get(message.chat.id);
  if (session) return leaderCreationReply(message);
  const normalized = message.text.trim().toLowerCase();
  const roleMatch = message.text.match(/(?:change|update|set|make)\s+(.+?)(?:'s)?\s+role\s+(?:to|as)\s+(.+)/i);
  if (roleMatch) return changeRoleByName(message.chat.id, roleMatch[1], roleMatch[2].trim());
  if (/\b(start|create|make|begin|new)\b.*\bproject\b/.test(normalized)) return continueProjectCreation(message.chat.id, {});
  if (/\b(show|list|view)\b.*\bprojects?\b/.test(normalized)) return showProjects(message.chat.id);
  if (aiEnabled() && /\b(send|post|ask|message|write|tell|share|request)\b/i.test(message.text)) {
    try {
      if (await draftFounderGroupMessage(message)) return;
    } catch (error) {
      console.error('Founder group message draft error:', error.message);
      return sendMessage(config.leaderToken, message.chat.id, 'I could not prepare that group message just now. Please try again.');
    }
  }
  if (/\b(update|status|progress|going)\b/.test(normalized)) {
    const projects = await store.rows('Projects');
    const match = projects.find((project) => normalized.includes(project.ProjectName.toLowerCase()));
    if (match) return leaderCommand({ ...message, text: `/project ${match.ProjectID}` });
    const activeProjects = projects.filter((project) => project.Status !== 'Archived');
    if (activeProjects.length === 1) return leaderCommand({ ...message, text: `/project ${activeProjects[0].ProjectID}` });
    if (activeProjects.length > 1) {
      const options = activeProjects.map((project) => `• <b>${escape(project.ProjectName)}</b> (<code>${escape(project.ProjectID)}</code>)`).join('\n');
      return sendMessage(config.leaderToken, message.chat.id, `Which project would you like an update on?\n\n${options}`);
    }
    return sendMessage(config.leaderToken, message.chat.id, 'There are no active projects yet. Say “start a project” whenever you are ready.');
  }
  if (!aiEnabled()) return sendMessage(config.leaderToken, message.chat.id, 'I can help with projects, but AI is not configured yet. You can still use /help.');
  try {
    return await founderChatReply(message);
  } catch (error) {
    console.error('Founder chat error:', error.message);
    return sendMessage(config.leaderToken, message.chat.id, 'I hit a small snag replying just now. Try once more, or use /help for the project controls.');
  }
}

async function leaderCallback(callback) {
  if (callback.data.startsWith('group_send:') || callback.data.startsWith('group_cancel:')) {
    if (String(callback.from.id) !== config.founderTelegramId) return answerCallback(config.leaderToken, callback.id, 'Only the founder can send project messages.');
    const [action, draftId] = callback.data.split(':');
    const draft = founderGroupMessageDrafts.get(draftId);
    if (!draft || Date.now() - draft.createdAt > 15 * 60 * 1000) {
      founderGroupMessageDrafts.delete(draftId);
      return answerCallback(config.leaderToken, callback.id, 'This draft expired. Please ask me to prepare the message again.');
    }
    if (action === 'group_cancel') {
      founderGroupMessageDrafts.delete(draftId);
      return answerCallback(config.leaderToken, callback.id, 'Cancelled. No group message was sent.');
    }
    if (draft.sending) return answerCallback(config.leaderToken, callback.id, 'This message is already being sent.');
    const project = await store.projectById(draft.projectId);
    if (!project || !project.GroupChatID || ['Completed', 'Abandoned'].includes(project.Status)) {
      founderGroupMessageDrafts.delete(draftId);
      return answerCallback(config.leaderToken, callback.id, 'This project group is no longer active.');
    }
    draft.sending = true;
    try {
      await sendMessage(config.groupToken, project.GroupChatID, escape(draft.text));
    } catch (error) {
      draft.sending = false;
      console.error('Founder group message error:', error.message);
      await answerCallback(config.leaderToken, callback.id, 'Could not send to the project group.');
      return sendMessage(config.leaderToken, callback.message.chat.id, `I could not post to <b>${escape(project.ProjectName)}</b>. Please check that the project group bot is still in that group, then tap Send again.`);
    }
    founderGroupMessageDrafts.delete(draftId);
    await answerCallback(config.leaderToken, callback.id, 'Sent to the project group.');
    try {
      await store.audit({ projectId: project.ProjectID, action: 'Founder group message sent', actor: callback.from.id, actorName: actor(callback.from).name, source: 'Telegram founder bot', details: draft.text });
    } catch (error) {
      console.error('Founder group message audit error:', error.message);
    }
    return sendMessage(config.leaderToken, callback.message.chat.id, `✅ Sent to <b>${escape(project.ProjectName)}</b>.`);
  }
  if (callback.data.startsWith('close_project:')) {
    if (String(callback.from.id) !== config.founderTelegramId) return answerCallback(config.leaderToken, callback.id, 'Only the founder can close a project.');
    const [, projectId, decision] = callback.data.split(':');
    const project = await store.projectById(projectId);
    if (!project) return answerCallback(config.leaderToken, callback.id, 'This project no longer exists.');
    if (decision === 'keep_active') {
      await store.audit({ projectId, action: 'Founder departure dismissed', actor: callback.from.id, actorName: actor(callback.from).name, source: 'Telegram founder bot', details: 'Founder chose to keep the project active.' });
      await answerCallback(config.leaderToken, callback.id, 'Project remains active.');
      return sendMessage(config.leaderToken, callback.message.chat.id, `Got it — <b>${escape(project.ProjectName)}</b> remains active. Nothing was changed.`);
    }
    const outcome = decision === 'completed' ? 'Completed' : decision === 'abandoned' ? 'Abandoned' : '';
    if (!outcome) return answerCallback(config.leaderToken, callback.id, 'Unknown project-closure decision.');
    if (['Completed', 'Abandoned'].includes(project.Status)) return answerCallback(config.leaderToken, callback.id, 'This project is already closed.');
    try {
      const result = await store.closeProject({ project, outcome, actorTelegramId: callback.from.id, actorName: actor(callback.from).name });
      await answerCallback(config.leaderToken, callback.id, `Project marked ${outcome.toLowerCase()}.`);
      await sendMessage(config.leaderToken, callback.message.chat.id, `✅ <b>${escape(project.ProjectName)}</b> is now <b>${outcome.toLowerCase()}</b>.\n\nNo data was deleted. ${result.closedTasks} unfinished task(s) were closed, and ${result.deactivatedMembers} project member record(s) were deactivated.`);
      return sendMessage(config.groupToken, project.GroupChatID, `<b>Project closed — ${escape(outcome)}</b>\n\nThe founder closed this project. Its full history is retained, but task updates are no longer active.`);
    } catch (error) {
      console.error('Project closure error:', error.message);
      return answerCallback(config.leaderToken, callback.id, 'Could not close this project. Check the Railway logs.');
    }
  }
  if (callback.data.startsWith('choose_plan:')) {
    if (String(callback.from.id) !== config.founderTelegramId) return answerCallback(config.leaderToken, callback.id, 'Only the founder can assign a project plan.');
    const [, projectId, workflowId] = callback.data.split(':');
    const option = WORKFLOW_OPTIONS.find((item) => item.id === workflowId);
    const project = await store.projectById(projectId);
    if (!option || !project) return answerCallback(config.leaderToken, callback.id, 'That project plan is no longer available.');
    const existingTasks = await store.tasksForProject(projectId);
    const legacyPlan = isUntouchedLegacyPlan(project, existingTasks);
    if (existingTasks.length && !legacyPlan) return answerCallback(config.leaderToken, callback.id, 'This project already has active work, so its plan cannot be replaced automatically.');
    try {
      const { assignWorkflowToProject } = await import('./project-service.js');
      const result = await assignWorkflowToProject({ store, project, workflowId, actorTelegramId: config.founderTelegramId, replaceUntouchedLegacyPlan: legacyPlan });
      await answerCallback(config.leaderToken, callback.id, 'Project plan assigned.');
      await sendMessage(config.leaderToken, callback.message.chat.id, `✅ <b>${escape(option.label)}</b> assigned to <b>${escape(project.ProjectName)}</b>.\n${result.taskCount} tasks generated. Planned finish: ${escape(result.targetEndDate)}.`);
      await sendMessage(config.groupToken, project.GroupChatID, `<b>Project plan assigned — ${escape(option.label)}</b>\n\n${planOverview(result.workflow)}\n\n${result.taskCount} tasks are now active. Use /tasks to see the full plan.`);
      await requestClientResources(project, result.workflow);
      await shareWorkflowResources(project, workflowId);
      return;
    } catch (error) {
      console.error('Workflow assignment error:', error.message);
      return answerCallback(config.leaderToken, callback.id, 'Could not assign this plan. Check the Railway logs.');
    }
  }
  if (callback.data.startsWith('onboard_role:')) {
    if (String(callback.from.id) !== config.founderTelegramId) return answerCallback(config.leaderToken, callback.id, 'Only the founder can assign project roles.');
    const onboarding = await store.onboarding(callback.data.slice('onboard_role:'.length));
    if (!onboarding || onboarding.Status !== 'Pending') return answerCallback(config.leaderToken, callback.id, 'This member profile is no longer pending.');
    founderRoleAssignments.set(callback.message.chat.id, onboarding.OnboardingID);
    await answerCallback(config.leaderToken, callback.id, 'Reply with name and role.');
    return sendMessage(config.leaderToken, callback.message.chat.id, `Reply with this member’s profile in one line:\n<code>Full name | Role</code>\n\nExample: <code>Rahul Sharma | Electrical contractor</code>`);
  }
  if (callback.data.startsWith('create_group:')) {
    if (String(callback.from.id) !== config.founderTelegramId) return answerCallback(config.leaderToken, callback.id, 'Only the founder can create a project.');
    const session = projectCreation.get(callback.message.chat.id);
    if (!session || session.step !== 'group') return answerCallback(config.leaderToken, callback.id, 'Project creation session expired. Start /createproject again.');
    const groupChatId = callback.data.slice('create_group:'.length);
    try {
      const projectId = await nextProjectId();
      const { createProjectShell } = await import('./project-service.js');
      await createProjectShell({
        store, projectId, projectName: session.projectName, clientName: session.clientName,
        startDateText: session.startDateText, groupChatId, leaderTelegramId: config.founderTelegramId,
      });
      projectCreation.delete(callback.message.chat.id);
      await answerCallback(config.leaderToken, callback.id, 'Project created.');
      await sendMessage(config.leaderToken, callback.message.chat.id, `✅ <b>${escape(session.projectName)}</b> created as <code>${projectId}</code>.\n\nIt is waiting for the client to join the group. Once you approve their role as <b>Client</b>, I’ll ask you which plan to assign.`);
      return sendMessage(config.groupToken, groupChatId, `🏠 <b>${escape(session.projectName)}</b> is now connected.\n\nAdd the client to this group. Once the founder confirms them as <b>Client</b>, the founder bot will select the project plan and share its linked resources here.`);
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
  if (update.message) await handleProjectResourceUpload(update.message);
  if (update.message?.text) {
    const mentioned = update.message.text.toLowerCase().includes(groupBotMention);
    console.log(`Group bot received update ${update.update_id} in ${update.message.chat.type}; mentioned: ${mentioned}; command: ${update.message.text.startsWith('/')}.`);
  }
  if (update.message?.text?.startsWith('/')) await groupCommand(update.message);
  else if (update.message?.text) {
    const text = update.message.text.trim();
    const isMention = text.toLowerCase().includes(groupBotMention);
    const isReplyToBot = update.message.reply_to_message?.from?.username === groupBotProfile.username;
    if (isMention || isReplyToBot) {
      const project = await requireProject(update.message.chat, config.groupToken);
      const naturalLanguageUpdate = text.replaceAll(new RegExp(groupBotMention.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '').trim();
      if (project && /\b(status|update|progress|going)\b/i.test(naturalLanguageUpdate)) {
        await sendMessage(config.groupToken, update.message.chat.id, await projectTldr(project));
        return;
      }
      if (project && naturalLanguageUpdate) await interpretNaturalLanguage(update.message, project, naturalLanguageUpdate);
    }
  }
  if (update.callback_query) await groupCallback(update.callback_query);
  if (update.chat_member) {
    await handleFounderGroupDeparture(update);
    await welcomeNewProjectMember(update);
  }
});
poll(config.leaderToken, 'Founder bot', async (update) => {
  if (update.message?.text?.startsWith('/')) await leaderCommand(update.message);
  else if (update.message?.text) await leaderNaturalLanguageReply(update.message);
  if (update.callback_query) await leaderCallback(update.callback_query);
});
