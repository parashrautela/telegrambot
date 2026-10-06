import test from 'node:test';
import assert from 'node:assert/strict';
import {archiveProjectResource} from './drive-storage.js';
import {retryProjectResources} from './project-resources.js';

test('Drive uploads actual bytes, recovers an acknowledged file, and retries pending metadata',async(t)=>{
  const saved={...process.env},original=fetch;
  Object.assign(process.env,{GOOGLE_DRIVE_FOLDER_ID:'parent-test',GOOGLE_DRIVE_REFRESH_TOKEN:'fake',GOOGLE_CLIENT_ID:'fake',GOOGLE_CLIENT_SECRET:'fake',GROUP_BOT_TOKEN:'fake',WEB_APP_URL:'https://web.test',INTEGRATION_SHARED_SECRET:'fake'});
  t.after(()=>{globalThis.fetch=original;for(const k of ['GOOGLE_DRIVE_FOLDER_ID','GOOGLE_DRIVE_REFRESH_TOKEN','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GROUP_BOT_TOKEN','WEB_APP_URL','INTEGRATION_SHARED_SECRET'])if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];});
  let folder=false,file=false,uploads=0,synced=0;
  globalThis.fetch=async(url,options={})=>{
    const u=new URL(url);
    if(u.hostname==='oauth2.googleapis.com')return Response.json({access_token:'test-token'});
    if(u.pathname==='/drive/v3/files' && !options.method)return Response.json({files:u.searchParams.get('q').startsWith("'parent-test'")?(folder?[{id:'project-folder'}]:[]):(file?[{id:'stored-file'}]:[])});
    if(u.pathname==='/drive/v3/files' && options.method==='POST'){assert.equal(JSON.parse(options.body).parents[0],'parent-test');folder=true;return Response.json({id:'project-folder'});}
    if(u.pathname==='/botfake/getFile')return Response.json({ok:true,result:{file_path:'documents/test.pdf',file_size:5}});
    if(u.pathname==='/file/botfake/documents/test.pdf')return new Response(Buffer.from('HELLO'));
    if(u.pathname==='/upload/drive/v3/files'){assert.ok(options.body.includes(Buffer.from('HELLO')));assert.ok(options.body.includes(Buffer.from('drawing.pdf')));assert.equal(u.searchParams.get('supportsAllDrives'),'true');file=true;uploads++;return Response.json({id:'stored-file'});}
    if(u.hostname==='web.test'){synced++;return Response.json({ok:true});}
    throw new Error(`Unexpected mock path ${u.pathname}`);
  };
  const project={ProjectID:'P1',ProjectName:'Test'},record={SubmissionID:'RES--123-10',FileName:'drawing.pdf',TelegramFileID:'fake',MimeType:'application/pdf'};
  assert.equal((await archiveProjectResource({project,record})).id,'stored-file');
  assert.equal((await archiveProjectResource({project,record})).id,'stored-file');assert.equal(uploads,1);
  const row={...record,ProjectID:'P1',rowNumber:2,DriveStatus:'Pending'};
  const store={rows:async()=>[row],projectById:async()=>project,updateRow:async(name,number,changes)=>Object.assign(row,changes)};
  await retryProjectResources(store,async()=>{throw new Error('mock Drive outage');});assert.equal(row.DriveStatus,'Pending');assert.equal(row.WebSyncStatus,'Synced');
  await retryProjectResources(store,archiveProjectResource);assert.equal(row.DriveStatus,'Stored');assert.equal(row.WebSyncStatus,'Synced');assert.equal(row.DriveFileID,'stored-file');assert.equal(uploads,1);assert.equal(synced,2);
  const waiting=Array.from({length:21},(_,i)=>({...record,SubmissionID:`RES--123-${i}`,rowNumber:i+2,ProjectID:'P1',DriveStatus:'Pending'})),visited=new Set();
  const queue={rows:async()=>waiting,projectById:async()=>project,updateRow:async(name,num,changes)=>Object.assign(waiting[num-2],changes)};
  const unavailable=async({record})=>{visited.add(record.SubmissionID);throw new Error('mock outage');};
  await retryProjectResources(queue,unavailable);await retryProjectResources(queue,unavailable);assert.equal(visited.size,21,'a failed first batch must not starve later documents');
});
