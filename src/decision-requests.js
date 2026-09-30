const name = (from) => [from?.first_name, from?.last_name].filter(Boolean).join(' ') || from?.username || 'Unknown sender';

export function parseDecisionRequest(message, botUsername) {
  if (!['group', 'supergroup'].includes(message.chat?.type)) return null;
  const text = (message.text || message.caption || '').trim();
  const match = text.match(/^\/(approval|question)(?:@([\w]+))?(?:\s+([\s\S]*))?$/i);
  if (!match || (match[2] && match[2].toLowerCase() !== botUsername.toLowerCase())) return null;
  const original = message.reply_to_message || message;
  const context = (match[3] || '').trim();
  const attachments = [];
  const photo = original.photo?.at(-1);
  if (photo) attachments.push({ type: 'Photo', fileId: photo.file_id });
  for (const type of ['document', 'video', 'voice', 'audio']) {
    const file = original[type];
    if (file) attachments.push({ type, fileId: file.file_id, fileName: file.file_name || '', mimeType: file.mime_type || '' });
  }
  const originalText = message.reply_to_message ? (original.text || original.caption || '') : context;
  if (!originalText && !attachments.length && !context) {
    throw new Error('Reply to a message with /approval or /question, or add your request after the command.');
  }
  return {
    RequestID: `REQ-${message.chat.id}-${original.message_id}-${match[1].toLowerCase()}`,
    GroupChatID: String(message.chat.id), SourceMessageID: String(original.message_id),
    CommandMessageID: String(message.message_id), RequestedByTelegramID: String(message.from?.id || ''),
    RequestedByName: name(message.from), OriginalSenderTelegramID: String(original.from?.id || original.sender_chat?.id || ''),
    OriginalSenderName: original.sender_chat?.title || name(original.from),
    RequestType: match[1].toLowerCase() === 'approval' ? 'Approval' : 'Question',
    OriginalMessage: originalText, RequestContext: message.reply_to_message ? context : '',
    AttachmentsJSON: JSON.stringify(attachments), Status: 'Pending',
    CreatedAt: new Date((message.date || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
  };
}

// Call from the single group polling worker; repeated commands on the same source
// and request type return the existing item rather than creating duplicates.
export async function captureDecisionRequest(store, project, request) {
  const existing = (await store.rows('DecisionRequests')).find((row) => row.RequestID === request.RequestID);
  if (existing) return { request: existing, created: false };
  const member = await store.user(request.RequestedByTelegramID);
  const record = { ...request, ProjectID: project.ProjectID, RequestedByRole: member?.Role || 'Unassigned' };
  await store.append('DecisionRequests', record, { raw: true });
  return { request: record, created: true };
}

export async function syncDecisionRequest(project, request) {
  const baseUrl = process.env.WEB_APP_URL?.replace(/\/$/, '');
  const secret = process.env.INTEGRATION_SHARED_SECRET;
  if (!baseUrl || !secret) return { configured: false };
  const response = await fetch(`${baseUrl}/api/integrations/telegram/requests`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
    body: JSON.stringify({ ...request, TelegramProjectID: project.ProjectID }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Web app request sync failed (${response.status})`);
  const result = await response.json();
  return { configured: true, status: result.request?.status || request.Status };
}
