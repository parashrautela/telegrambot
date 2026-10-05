import test from 'node:test';
import assert from 'node:assert/strict';
import { captureDecisionRequest, parseDecisionRequest, parseClientRequest, retryDecisionRequestSync } from './decision-requests.js';

const message = { chat: { id: -123, type: 'supergroup' }, message_id: 10, date: 1700000000, from: { id: 1, first_name: 'Lead' }, text: '/approval Buy these lights?' };
test('direct request and bot targeting', () => {
  assert.equal(parseDecisionRequest(message, 'our_bot').OriginalMessage, 'Buy these lights?');
  assert.equal(parseDecisionRequest({ ...message, text: '/question@other_bot hi' }, 'our_bot'), null);
  assert.equal(parseDecisionRequest({ ...message, text: '/question@OUR_BOT hi' }, 'our_bot').RequestType, 'Question');
  assert.equal(parseDecisionRequest({ ...message, chat: { id: 1, type: 'private' } }, 'our_bot'), null);
  assert.equal(parseDecisionRequest({ ...message, text: 'ordinary chat' }, 'our_bot'), null);
  assert.throws(() => parseDecisionRequest({ ...message, text: '/approval' }, 'our_bot'), /Reply to/);
});
test('reply preserves original sender, photo and request context', () => {
  const request = parseDecisionRequest({ ...message, text: '/approval Please check', reply_to_message: {
    message_id: 7, from: { id: 2, first_name: 'Client' }, caption: 'Socket here?', photo: [{ file_id: 'small' }, { file_id: 'large' }],
  } }, 'our_bot');
  assert.equal(request.SourceMessageID, '7');
  assert.equal(request.OriginalSenderName, 'Client');
  assert.equal(request.RequestedByName, 'Lead');
  assert.equal(request.RequestContext, 'Please check');
  assert.equal(request.OriginalMessage, 'Socket here?');
  assert.equal(JSON.parse(request.AttachmentsJSON)[0].fileId, 'large');
});
test('caption commands support a document without text', () => {
  const request = parseDecisionRequest({ ...message, text: undefined, caption: '/approval', document: { file_id: 'doc', file_name: 'plan.pdf' } }, 'our_bot');
  assert.equal(JSON.parse(request.AttachmentsJSON)[0].fileName, 'plan.pdf');
});
test('capture persists raw content, project and role, and deduplicates repeated requests', async () => {
  const records = [];
  const store = { rows: async () => records, user: async () => ({ Role: 'Designer' }), append: async (sheet, record, options) => {
    assert.equal(sheet, 'DecisionRequests');
    assert.equal(options.raw, true);
    records.push(record);
  } };
  const request = parseDecisionRequest({ ...message, text: '/approval =1+1' }, 'our_bot');
  const first = await captureDecisionRequest(store, { ProjectID: 'P001' }, request);
  const second = await captureDecisionRequest(store, { ProjectID: 'P001' }, { ...request, CommandMessageID: '11' });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(records.length, 1);
  assert.equal(records[0].ProjectID, 'P001');
  assert.equal(records[0].RequestedByRole, 'Designer');
  assert.equal(records[0].OriginalMessage, '=1+1');
});

test('assigned client ordinary text and photo become queries without capturing staff or commands', () => {
  const project = { ProjectID: 'P001', GroupChatID: '-123', ClientTelegramID: '42' };
  const clientMessage = { ...message, from: { id: 42, first_name: 'Maya' }, text: 'Can we move the light?' };
  const request = parseClientRequest(clientMessage, project, 'our_bot');
  assert.equal(request.OriginalMessage, clientMessage.text);
  assert.equal(request.AutomaticClientQuery, 'Yes');
  assert.equal(request.RequestID, 'REQ--123-10-question');
  assert.equal(parseClientRequest(message,project,'our_bot'),null);
  assert.equal(parseClientRequest({...clientMessage,text:'/tasks'},project,'our_bot'),null);
  assert.equal(parseClientRequest(clientMessage,{...project,GroupChatID:'-456'},'our_bot'),null);
  assert.equal(parseClientRequest({...clientMessage,from:{id:42,is_bot:true}},project,'our_bot'),null);
  assert.equal(parseClientRequest(clientMessage,{...project,ClientTelegramID:''},'our_bot'),null);
  const photo = parseClientRequest({...clientMessage,text:undefined,photo:[{file_id:'small'},{file_id:'large'}]},project,'our_bot');
  assert.equal(JSON.parse(photo.AttachmentsJSON)[0].fileId,'large');
});

test('persisted request sync retries failures and stops after acknowledged delivery', async (t) => {
  const previous = { url: process.env.WEB_APP_URL, secret: process.env.INTEGRATION_SHARED_SECRET, fetch: globalThis.fetch };
  process.env.WEB_APP_URL = 'https://workspace.test'; process.env.INTEGRATION_SHARED_SECRET = 'test-secret';
  t.after(() => { if (previous.url === undefined) delete process.env.WEB_APP_URL; else process.env.WEB_APP_URL=previous.url; if (previous.secret === undefined) delete process.env.INTEGRATION_SHARED_SECRET; else process.env.INTEGRATION_SHARED_SECRET=previous.secret; globalThis.fetch=previous.fetch; });
  const project = {ProjectID:'P001',GroupChatID:'-123'};
  const row = {...parseDecisionRequest(message,'our_bot'),ProjectID:'P001',rowNumber:2,AutomaticClientQuery:'Yes'};
  const store = { rows:async(sheet)=>sheet==='Projects'?[project]:[row], updateRow:async(sheet,number,input)=>{assert.equal(number,2);Object.assign(row,input);} };
  let count=0;
  globalThis.fetch=async(url,options)=>{count++;assert.equal(JSON.parse(options.body).AutomaticClientQuery,true);if(count===1)throw new Error('offline');return Response.json({request:{status:'Pending'}});};
  await retryDecisionRequestSync(store); assert.equal(row.WebSyncStatus,undefined);
  await retryDecisionRequestSync(store); assert.equal(row.WebSyncStatus,'Synced'); assert.ok(row.WebSyncedAt);
  await retryDecisionRequestSync(store); assert.equal(count,2);
});
