// Service-message departures override the sender so leaving cannot reactivate someone.
export async function recordMessageMembers(message, record) {
  const members = new Map();
  if (!message.sender_chat && message.from) members.set(message.from.id, [message.from, 'Active']);
  for (const member of message.new_chat_members || []) members.set(member.id, [member, 'Active']);
  if (message.left_chat_member)
    members.set(message.left_chat_member.id, [message.left_chat_member, 'Left']);
  for (const [member, status] of members.values()) {
    if (!member.is_bot) await record(message.chat, member, status);
  }
}
