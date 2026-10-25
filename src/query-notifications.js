const sending = new Set();
export async function notifyQuery({ store, request, input, token, fetchImpl = fetch }) {
  const text = typeof input.response === 'string' ? input.response.trim() : '';
  if (!text || text.length > 3000 || !/^[a-zA-Z0-9-]{1,100}$/.test(input.notificationId || ''))
    return { ok: false, deliveryStatus: 'Failed', error: 'Invalid query update.' };
  const entries = JSON.parse(request.StatusNoticesJSON || '[]');
  const prior = entries.find(row => row.id === input.notificationId);
  if (prior) return prior.text !== text ? { ok: false, deliveryStatus: 'Failed' }
    : { ok: prior.status === 'Sent', deliveryStatus: prior.status, result: prior.messageId ? { message_id: prior.messageId } : undefined };
  if (sending.has(request.RequestID)) return { ok: false, deliveryStatus: 'Failed' };
  if (entries.length >= 80) return { ok: false, deliveryStatus: 'Failed', error: 'Query update history is full.' };
  const entry = { id: input.notificationId, text, status: 'Sending' };
  if (JSON.stringify([...entries, entry]).length > 45000) return { ok: false, deliveryStatus: 'Failed', error: 'Query update history is full.' };
  entries.push(entry);
  const save = () => store.updateRow('DecisionRequests', request.rowNumber, { StatusNoticesJSON: JSON.stringify(entries) });
  sending.add(request.RequestID);
  try {
    await save();
    try {
      const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: request.GroupChatID, text, reply_parameters: { message_id: Number(request.SourceMessageID), allow_sending_without_reply: true } }),
        signal: AbortSignal.timeout(10000), redirect: 'error',
      });
      const result = await response.json();
      entry.status = response.ok && result.ok && Number.isSafeInteger(result.result?.message_id) && result.result.message_id > 0
        ? 'Sent' : result.ok === false && response.status < 500 ? 'Failed' : 'Unknown';
      if (entry.status === 'Sent') entry.messageId = result.result.message_id;
    } catch { entry.status = 'Unknown'; }
    await save();
    return { ok: entry.status === 'Sent', deliveryStatus: entry.status, result: entry.messageId ? { message_id: entry.messageId } : undefined };
  } finally { sending.delete(request.RequestID); }
}
