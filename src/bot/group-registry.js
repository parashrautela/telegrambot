import { getChatAdministrators } from '../integrations/telegram.js';
import { recordMessageMembers } from '../bot/group-discovery.js';
import { groupOnly, joinedStatus } from './message-utils.js';

export function createGroupRegistry({ config, groupBotProfile, store }) {
  const observedGroups = new Set();
  async function observeGroup(chat) {
    if (!groupOnly(chat) || observedGroups.has(String(chat.id))) return;
    await store.registerGroup(chat.id, chat.title || 'Unnamed Telegram group');
    observedGroups.add(String(chat.id));
    try {
      const admins = await getChatAdministrators(config.groupToken, chat.id);
      for (const admin of admins) await store.upsertGroupMember(chat.id, admin.user, 'Active');
    } catch (error) {
      console.warn('Could not read group administrators:', error.message);
    }
    await syncGroupRoster().catch((error) => console.warn(error.message));
  }

  async function syncGroupRoster() {
    const baseUrl = process.env.WEB_APP_URL?.replace(/\/$/, '');
    const secret = process.env.INTEGRATION_SHARED_SECRET;
    if (!baseUrl || !secret) return;
    const response = await fetch(`${baseUrl}/api/integrations/telegram/groups/snapshot`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
      body: JSON.stringify({ groups: await store.groupSnapshot() }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Group roster sync failed (${response.status})`);
  }

  async function recordGroupMember(chat, member, status) {
    if (!groupOnly(chat) || !member || member.is_bot) return;
    await observeGroup(chat);
    await store.upsertGroupMember(chat.id, member, status);
    await syncGroupRoster().catch((error) => console.warn(error.message));
  }

  async function discoverGroup(update) {
    const change = update.my_chat_member;
    if (
      change &&
      groupOnly(change.chat) &&
      String(change.new_chat_member?.user?.id) === String(groupBotProfile.id) &&
      joinedStatus.has(change.new_chat_member?.status)
    ) {
      await observeGroup(change.chat);
    }
    const memberChange = update.chat_member;
    if (memberChange && groupOnly(memberChange.chat)) {
      const member = memberChange.new_chat_member?.user;
      const status = memberChange.new_chat_member?.status;
      if (
        member &&
        !member.is_bot &&
        (joinedStatus.has(status) || ['left', 'kicked'].includes(status))
      ) {
        await recordGroupMember(
          memberChange.chat,
          member,
          joinedStatus.has(status) ? 'Active' : 'Left',
        );
      }
    }
    const message = update.message;
    if (message && groupOnly(message.chat)) {
      await observeGroup(message.chat);
      if (message.new_chat_title) {
        await store.registerGroup(message.chat.id, message.new_chat_title);
        await syncGroupRoster().catch((error) => console.warn(error.message));
      }
      await recordMessageMembers(message, recordGroupMember);
    }
  }
  return { syncGroupRoster, recordGroupMember, discoverGroup };
}
