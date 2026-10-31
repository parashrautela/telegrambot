import { getChatMember, sendMessage } from '../integrations/telegram.js';
import crypto from 'node:crypto';
import { joinedStatus, escape, groupOnly, actor } from './message-utils.js';

export function createMembershipHandlers({ config, leaderBotProfile, projectTldr, store }) {
  async function recoverFounderDepartureAlerts() {
    const auditEntries = await store.rows('AuditLog');
    const projects = (await store.rows('Projects')).filter(
      (project) => !['Completed', 'Abandoned'].includes(project.Status),
    );
    for (const project of projects) {
      if (
        auditEntries.some(
          (entry) =>
            entry.ProjectID === project.ProjectID && entry.Action === 'Founder left project group',
        )
      )
        continue;
      try {
        const member = await getChatMember(
          config.groupToken,
          project.GroupChatID,
          config.founderTelegramId,
        );
        if (joinedStatus.has(member.status)) continue;
        await store.audit({
          projectId: project.ProjectID,
          action: 'Founder left project group',
          oldValue: 'Unknown',
          newValue: member.status,
          actor: config.founderTelegramId,
          actorName: 'Founder',
          source: 'Startup membership check',
          details:
            'Founder absence detected after a restart; awaiting closure decision. No project data changed.',
        });
        await sendMessage(
          config.leaderToken,
          config.founderTelegramId,
          `<b>You are no longer in ${escape(project.ProjectName)}</b>\n\nShould I close this project as completed or abandoned? Nothing will be deleted either way.`,
          {
            inline_keyboard: [
              [
                {
                  text: 'Mark completed',
                  callback_data: `close_project:${project.ProjectID}:completed`,
                },
                {
                  text: 'Mark abandoned',
                  callback_data: `close_project:${project.ProjectID}:abandoned`,
                },
              ],
              [
                {
                  text: 'I left by accident — keep active',
                  callback_data: `close_project:${project.ProjectID}:keep_active`,
                },
              ],
            ],
          },
        );
      } catch (error) {
        console.warn(`Could not check founder membership for ${project.ProjectID}:`, error.message);
      }
    }
  }

  async function welcomeNewProjectMember(update) {
    const change = update.chat_member;
    if (!change || !groupOnly(change.chat)) return;
    const oldStatus = change.old_chat_member?.status;
    const newStatus = change.new_chat_member?.status;
    const member = change.new_chat_member?.user;
    if (!member || member.is_bot || joinedStatus.has(oldStatus) || !joinedStatus.has(newStatus))
      return;
    const project = await store.projectForGroup(change.chat.id);
    if (!project || (await store.onboardingForMember(project.ProjectID, member.id))) return;
    const onboardingId = `ONB-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const memberName = actor(member).name;
    await store.createOnboarding({
      onboardingId,
      projectId: project.ProjectID,
      groupChatId: change.chat.id,
      telegramId: member.id,
      telegramName: memberName,
    });
    await store.audit({
      projectId: project.ProjectID,
      action: 'Member joined — pending profile',
      actor: member.id,
      actorName: memberName,
      source: 'Telegram group bot',
      details: onboardingId,
    });
    const profileLink = `https://t.me/${leaderBotProfile.username}?start=profile_${onboardingId}`;
    await sendMessage(
      config.groupToken,
      change.chat.id,
      `Welcome <b>${escape(memberName)}</b> 👋\n\nI’m setting up your project profile. Meanwhile, here is where the project stands:\n\n${await projectTldr(project)}\n\nThe founder will confirm your role shortly.`,
      process.env.WEB_APP_URL
        ? undefined
        : { inline_keyboard: [[{ text: 'Set up my profile', url: profileLink }]] },
    );
    if (process.env.WEB_APP_URL && process.env.INTEGRATION_SHARED_SECRET) return;
    return sendMessage(
      config.leaderToken,
      config.founderTelegramId,
      `<b>New project member joined</b>\n\nName: ${escape(memberName)}\nProject: ${escape(project.ProjectName)}\nJoined: ${new Date(change.date * 1000).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}\n\nPlease assign their profile and role before they can update project tasks.`,
      {
        inline_keyboard: [[{ text: 'Assign role', callback_data: `onboard_role:${onboardingId}` }]],
      },
    );
  }

  async function handleFounderGroupDeparture(update) {
    const change = update.chat_member;
    if (!change || !groupOnly(change.chat)) return;
    const member = change.new_chat_member?.user;
    const oldStatus = change.old_chat_member?.status;
    const newStatus = change.new_chat_member?.status;
    if (
      !member ||
      String(member.id) !== config.founderTelegramId ||
      !joinedStatus.has(oldStatus) ||
      !['left', 'kicked'].includes(newStatus)
    )
      return;
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
    return sendMessage(
      config.leaderToken,
      config.founderTelegramId,
      `<b>You left ${escape(project.ProjectName)}</b>\n\nShould I close this project as completed or abandoned? Nothing will be deleted either way.`,
      {
        inline_keyboard: [
          [
            {
              text: 'Mark completed',
              callback_data: `close_project:${project.ProjectID}:completed`,
            },
            {
              text: 'Mark abandoned',
              callback_data: `close_project:${project.ProjectID}:abandoned`,
            },
          ],
          [
            {
              text: 'I left by accident — keep active',
              callback_data: `close_project:${project.ProjectID}:keep_active`,
            },
          ],
        ],
      },
    );
  }

  async function changeUserRole(chatId, user, role) {
    await store.updateRow('Users', user.rowNumber, { Role: role, Active: 'Yes' });
    return sendMessage(
      config.leaderToken,
      chatId,
      `✅ Updated <b>${escape(user.Name)}</b> to <b>${escape(role)}</b>.`,
    );
  }

  async function changeRoleByName(chatId, name, role) {
    const normalizedName = name.trim().toLowerCase();
    const matches = (await store.activeUsers()).filter(
      (user) =>
        user.Name.toLowerCase() === normalizedName ||
        user.Name.toLowerCase().includes(normalizedName),
    );
    if (matches.length === 1) return changeUserRole(chatId, matches[0], role);
    if (matches.length > 1)
      return sendMessage(
        config.leaderToken,
        chatId,
        `I found more than one active member matching “${escape(name)}”. Use <code>/role TELEGRAM_ID | New role</code> instead.`,
      );
    return sendMessage(
      config.leaderToken,
      chatId,
      `I could not find an active member named “${escape(name)}”. Use <code>/role TELEGRAM_ID | New role</code> instead.`,
    );
  }
  return {
    recoverFounderDepartureAlerts,
    welcomeNewProjectMember,
    handleFounderGroupDeparture,
    changeUserRole,
    changeRoleByName,
  };
}
