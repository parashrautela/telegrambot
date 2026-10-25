import test from 'node:test';
import assert from 'node:assert/strict';
import { notifyQuery } from './query-notifications.js';

test('hold then reject replies to the same sender thread once per action, including after reload', async () => {
  const request = {RequestID:'q',GroupChatID:'-5',SourceMessageID:'23',rowNumber:2};
  const store = {updateRow:async(sheet,row,changes)=>Object.assign(request,changes)};
  const sent=[];
  const call = async (notificationId,response,extra={}) => notifyQuery({store,request,input:{notificationId,response},token:'mock',fetchImpl:async(url,options)=>{assert.equal(JSON.parse(request.StatusNoticesJSON).at(-1).status,'Sending');sent.push(JSON.parse(options.body));return Response.json({ok:true,result:{message_id:sent.length}});},...extra});
  assert.equal((await call('hold-1','Please share more details.')).ok,true);
  assert.equal((await call('hold-1','Please share more details.')).ok,true);
  assert.equal((await call('hold-1','Changed text')).ok,false);
  assert.equal((await call('reject-1','We cannot proceed.')).ok,true);
  assert.equal(sent.length,2);
  assert.deepEqual(sent.map(row=>[row.chat_id,row.reply_parameters.message_id]),[['-5',23],['-5',23]]);
  const reloaded = JSON.parse(JSON.stringify(request));
  assert.equal((await call('reject-1','We cannot proceed.',{request:reloaded})).ok,true);
  assert.equal(sent.length,2);
  assert.equal(request.Status,undefined,'status notifications do not mark a query published');
});

test('uncertain send, interrupted persistence and invalid input never cause a duplicate', async () => {
  const request = {RequestID:'q2',GroupChatID:'-5',SourceMessageID:'23',rowNumber:2};
  const store = {updateRow:async(sheet,row,changes)=>Object.assign(request,changes)};
  let sends=0;
  const args={store,request,input:{notificationId:'action-1',response:'On hold.'},token:'mock',fetchImpl:async()=>{sends++;throw Error('timeout');}};
  assert.equal((await notifyQuery(args)).deliveryStatus,'Unknown');
  assert.equal((await notifyQuery(args)).deliveryStatus,'Unknown');
  assert.equal(sends,1);
  request.StatusNoticesJSON=JSON.stringify([{id:'action-2',text:'Accepted.',status:'Sending'}]);
  assert.equal((await notifyQuery({...args,input:{notificationId:'action-2',response:'Accepted.'}})).ok,false);
  assert.equal(sends,1);
  assert.equal((await notifyQuery({...args,input:{notificationId:'bad/key',response:'No'}})).deliveryStatus,'Failed');
  assert.equal(sends,1);
});
