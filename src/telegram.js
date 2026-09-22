const api = async (token, method, body = {}) => {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const json = await response.json();
  if (!json.ok) throw new Error(`Telegram ${method} failed: ${json.description}`);
  return json.result;
};

export const sendMessage = (token, chatId, text, replyMarkup) => api(token, 'sendMessage', {
  chat_id: chatId, text, parse_mode: 'HTML', ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
});
export const sendPhoto = (token, chatId, photo, caption = '') => api(token, 'sendPhoto', {
  chat_id: chatId, photo, ...(caption ? { caption, parse_mode: 'HTML' } : {}),
});
export const sendDocument = (token, chatId, document, caption = '') => api(token, 'sendDocument', {
  chat_id: chatId, document, ...(caption ? { caption, parse_mode: 'HTML' } : {}),
});
export const answerCallback = (token, callbackId, text = '') => api(token, 'answerCallbackQuery', { callback_query_id: callbackId, text });
export const getUpdates = (token, offset) => api(token, 'getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'callback_query', 'chat_member'] });
export const getMe = (token) => api(token, 'getMe');

export async function poll(token, label, onUpdate) {
  let offset = 0;
  console.log(`${label} polling started.`);
  while (true) {
    try {
      const updates = await getUpdates(token, offset);
      for (const update of updates) {
        offset = update.update_id + 1;
        await onUpdate(update);
      }
    } catch (error) {
      console.error(`${label} polling error:`, error.message);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}
