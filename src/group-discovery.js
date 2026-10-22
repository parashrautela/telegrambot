import { getChatAdministrators, getChatMember, getChatMemberCount, getMe } from './telegram.js';
// Service-message departures override the sender so leaving cannot reactivate someone.
export async function recordMessageMembers(message, record) {
  const members = new Map();
  if (!message.sender_chat && message.from) members.set(message.from.id, [message.from, 'Active']);
  for (const member of message.new_chat_members || []) members.set(member.id, [member, 'Active']);
  if (message.left_chat_member) members.set(message.left_chat_member.id, [message.left_chat_member, 'Left']);
  for (const [member, status] of members.values()) {
    if (!member.is_bot) await record(message.chat, member, status);
  }
}

export const activeMembership = member => ['creator', 'administrator', 'member'].includes(member?.status) || (member?.status === 'restricted' && member.is_member === true);

export async function refreshGroupMembers({ store, token, groupChatId, telegramUserId, api = { getChatAdministrators, getChatMember, getChatMemberCount, getMe } }) {
  const registry = await store.rows('GroupRegistry');
  const groups = registry.filter(group => group.Status !== 'Migrated' && (!groupChatId || String(group.GroupChatID) === String(groupChatId)));
  if (groupChatId && !groups.length) throw new Error('Telegram group not found.');
  if (telegramUserId && !/^\d+$/.test(String(telegramUserId))) throw new Error('Enter a numeric Telegram user ID.');
  const [users, members, me] = await Promise.all([store.rows('Users'), store.rows('GroupMembers'), api.getMe(token)]);
  const ids = [...new Set([...users, ...members].map(row => String(row.TelegramUserID || '')).filter(id => /^\d+$/.test(id)))];
  const metadata = new Map();
  for (const group of groups) {
    const chatId = String(group.GroupChatID);
    const admins = await api.getChatAdministrators(token, chatId);
    for (const admin of admins) if (!admin.user.is_bot) await store.upsertGroupMember(chatId, admin.user, 'Active');
    const warnings = [];
    for (const id of (telegramUserId ? [String(telegramUserId)] : ids)) {
      if (String(me.id) === id) continue;
      let member;
      try { member = await api.getChatMember(token, chatId, id); }
      catch (error) { if (telegramUserId) throw error; warnings.push('Some known memberships could not be checked. Refresh again.'); continue; }
      if (telegramUserId && (!activeMembership(member) || member.user.is_bot)) throw new Error('This person is not an active human member of this group.');
      if (!member.user?.is_bot && (activeMembership(member) || members.some(row => String(row.GroupChatID) === chatId && String(row.TelegramUserID) === id))) await store.upsertGroupMember(chatId, member.user, activeMembership(member) ? 'Active' : 'Left');
    }
    metadata.set(chatId, { telegramMemberCount: await api.getChatMemberCount(token, chatId), botUsername: me.username, botIsAdmin: admins.some(row => String(row.user.id) === String(me.id)), discoveryWarning: [...new Set(warnings)].join(' ') });
  }
  return { groups: (await store.groupSnapshot()).filter(group => !groupChatId || group.groupChatId === String(groupChatId)).map(group => ({ ...group, ...metadata.get(group.groupChatId) })) };
}
