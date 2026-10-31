import test from 'node:test';
import assert from 'node:assert/strict';
import { recordMessageMembers } from './group-discovery.js';

const chat = { id: -123, type: 'group' };
const person = { id: 7, first_name: 'Asha' };
async function recorded(message) {
  const rows = [];
  await recordMessageMembers({ chat, ...message }, async (...args) => rows.push(args));
  return rows;
}
test('discovers existing members from text, commands, and photos', async () => {
  for (const content of [{ text: 'hello' }, { text: '/join' }, { photo: [{}] }]) {
    assert.deepEqual(await recorded({ from: person, ...content }), [[chat, person, 'Active']]);
  }
});
test('ignores bots and anonymous or channel senders', async () => {
  assert.deepEqual(await recorded({ from: { ...person, is_bot: true } }), []);
  assert.deepEqual(await recorded({ from: person, sender_chat: chat }), []);
  assert.deepEqual(await recorded({}), []);
});
test('deduplicates joins and keeps departures inactive', async () => {
  assert.deepEqual(await recorded({ from: person, new_chat_members: [person] }), [
    [chat, person, 'Active'],
  ]);
  assert.deepEqual(await recorded({ from: person, left_chat_member: person }), [
    [chat, person, 'Left'],
  ]);
  const joining = { id: 8 };
  assert.deepEqual(await recorded({ from: person, new_chat_members: [joining] }), [
    [chat, person, 'Active'],
    [chat, joining, 'Active'],
  ]);
});
