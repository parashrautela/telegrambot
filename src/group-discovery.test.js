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
  assert.deepEqual(await recorded({ from: person, new_chat_members: [person] }), [[chat, person, 'Active']]);
  assert.deepEqual(await recorded({ from: person, left_chat_member: person }), [[chat, person, 'Left']]);
  const joining = { id: 8 };
  assert.deepEqual(await recorded({ from: person, new_chat_members: [joining] }), [[chat, person, 'Active'], [chat, joining, 'Active']]);
});

import { refreshGroupMembers, activeMembership } from './group-discovery.js';
test('refresh recovers known existing people, verifies departures and reports group account count', async () => {
  const saved = [];
  const rows = { GroupRegistry: [{GroupChatID:'-1'}], Users: [{TelegramUserID:'7'},{TelegramUserID:'8'},{TelegramUserID:'9'}], GroupMembers: [{GroupChatID:'-1',TelegramUserID:'8'}] };
  const store = {rows:async key=>rows[key],upsertGroupMember:async(chat,user,status)=>saved.push([chat,user.id,status]),groupSnapshot:async()=>[{groupChatId:'-1',members:[]}]};
  const api = {getMe:async()=>({id:99,username:'project_bot'}),getChatAdministrators:async()=>[{user:{id:99,is_bot:true}},{user:{id:1}}],getChatMember:async(token,chat,id)=>({status:id==='7'?'member':'left',user:{id:Number(id)}}),getChatMemberCount:async()=>4};
  const result = await refreshGroupMembers({store,token:'test',groupChatId:'-1',api});
  assert.deepEqual(saved,[['-1',1,'Active'],['-1',7,'Active'],['-1',8,'Left']]);
  assert.equal(result.groups[0].telegramMemberCount,4);
  assert.equal(result.groups[0].botIsAdmin,true);
  await assert.rejects(refreshGroupMembers({store,token:'test',groupChatId:'-1',telegramUserId:'9',api}),/not an active/);
  assert.equal(activeMembership({status:'restricted',is_member:false}),false);
});
