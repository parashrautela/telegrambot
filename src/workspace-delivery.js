export async function deliverReply(store, replyId, token, transport = fetch) {
  const r = store.get('SELECT r.*,i.projectId,i.taskId,i.requestId FROM replies r JOIN interventions i ON i.id=r.interventionId WHERE r.id=?', replyId);
  if (!r || r.state !== 'Queued') return;
  if (!token) { store.run("UPDATE replies SET state='Failed',error='Telegram delivery is not configured.' WHERE id=?", r.id); return; }
  const p = store.get('SELECT * FROM projects WHERE id=?', r.projectId);
  const request = store.get('SELECT * FROM requests WHERE id=?', r.requestId);
  const claimed = store.run("UPDATE replies SET state='Sending' WHERE id=? AND state='Queued'", r.id);
  if (!claimed.changes) return;
  try {
    const response = await transport(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: p.groupChatId, text: r.body, ...(request.sourceMessageId ? { reply_parameters: { message_id: Number(request.sourceMessageId) } } : {}) }), signal: AbortSignal.timeout(15000) });
    const result = await response.json();
    if (result.ok === false) { store.run("UPDATE replies SET state='Failed',error=? WHERE id=?", String(result.description || 'Telegram rejected the reply.').slice(0, 1000), r.id); return; }
    if (!response.ok || !result.result?.message_id) throw new Error('Uncertain response');
    store.transaction(() => {
      store.run("UPDATE replies SET state='Sent',telegramMessageId=?,error='' WHERE id=?", String(result.result.message_id), r.id);
      store.event({ name: 'Shared founder account' }, p.id, r.taskId, 'Telegram reply', r.body);
    });
  } catch { store.run("UPDATE replies SET state='Unknown',error='Delivery is uncertain. Check the Telegram group before sending again.' WHERE id=?", r.id); }
}
