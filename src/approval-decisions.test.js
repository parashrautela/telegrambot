import test from 'node:test';
import assert from 'node:assert/strict';
import {decideApprovalOnce} from './approval-decisions.js';
test('simultaneous founder decisions apply once across both bot loops and release on completion',async()=>{
 let release,decisions=0,busy=0;
 const first=decideApprovalOnce('approval',async()=>{decisions++;await new Promise(resolve=>{release=resolve;});return 'approved';},()=>busy++);
 await decideApprovalOnce('approval',async()=>{decisions++;},()=>busy++);
 assert.equal(decisions,1);assert.equal(busy,1);release();assert.equal(await first,'approved');
 await assert.rejects(decideApprovalOnce('failed',async()=>{throw Error('write failed');},()=>{}),/write failed/);
 assert.equal(await decideApprovalOnce('failed',async()=>'reloaded pending status',()=>{}),'reloaded pending status');
});
