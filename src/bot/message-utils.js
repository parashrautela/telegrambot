export const actor = (from) => ({
  id: from.id,
  name:
    [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || 'Unknown user',
});
export const groupOnly = (chat) => ['group', 'supergroup'].includes(chat.type);
export const escape = (value) =>
  String(value).replace(
    /[&<>]/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character],
  );
export const joinedStatus = new Set(['creator', 'owner', 'member', 'administrator', 'restricted']);
