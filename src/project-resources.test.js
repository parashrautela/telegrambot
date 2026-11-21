import test from 'node:test';
import assert from 'node:assert/strict';
import {retryProjectResources} from './project-resources.js';

test('the bot passes each file record to the web app until it is accepted, without starving later files',async(t)=>{
  const saved={...process.env},original=fetch;
  Object.assign(process.env,{WEB_APP_URL:'https://web.test',INTEGRATION_SHARED_SECRET:'fake'});
  t.after(()=>{globalThis.fetch=original;for(const k of ['WEB_APP_URL','INTEGRATION_SHARED_SECRET'])if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];});
  let up=false;const sent=[];
  globalThis.fetch=async(url,options)=>{
    assert.equal(new URL(url).pathname,'/api/integrations/telegram/resources');
    const record=JSON.parse(options.body);sent.push(record.SubmissionID);
    return up?Response.json({ok:true}):new Response('{}',{status:503});
  };
  const rows=Array.from({length:21},(_,i)=>({SubmissionID:`RES--123-${i}`,rowNumber:i+2,ProjectID:'P1',Caption:i===0?'kitchen wall':'',DriveStatus:'Pending'}));
  const store={rows:async()=>rows,updateRow:async(name,number,changes)=>Object.assign(rows[number-2],changes)};
  await retryProjectResources(store);await retryProjectResources(store);
  assert.equal(new Set(sent).size,21,'a failed first batch must not starve later files');
  assert.ok(rows.every((row)=>row.WebSyncStatus!=='Synced'));
  up=true;sent.length=0;
  await retryProjectResources(store);await retryProjectResources(store);
  assert.ok(rows.every((row)=>row.WebSyncStatus==='Synced'));
  await retryProjectResources(store);
  assert.equal(sent.length,21,'synced files are not sent again');
});
