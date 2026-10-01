import test from 'node:test';
import assert from 'node:assert/strict';
import { captureDecisionRequest, parseDecisionRequest } from './decision-requests.js';

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
