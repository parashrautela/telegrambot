import test from 'node:test';
import assert from 'node:assert/strict';
import {planStageConnections,stageLinksFor,connectionFingerprint} from './stage-connections.js';
const task=(id,stageId,start,end,dependencies=[])=>({id,stageId,start,end,dependencies,status:'Open',title:id});
const fixture=()=>[task('a','A','2026-10-01','2026-10-03'),task('b','B','2026-10-04','2026-10-08',[{id:'a',type:'FS'}]),task('c','C','2026-10-09','2026-10-10',[{id:'b',type:'FS'}])];
test('stage wires allow parallel starts and a successor waiting for both',()=>{
 const input=fixture(),links=[{source:'A',target:'B',type:'SS'},{source:'A',target:'C',type:'FS'},{source:'B',target:'C',type:'FS'}];
 const result=planStageConnections(input,links);
 assert.equal(result.tasks.find(task=>task.id==='b').start,'2026-10-01');assert.equal(result.tasks.find(task=>task.id==='c').start,'2026-10-06');
 assert.equal(result.tasks.find(task=>task.id==='c').dependencies.length,2);assert.equal(input[1].start,'2026-10-04');assert.equal(stageLinksFor(result.tasks).length,3);
});
test('connections reject cycles, self-links, unrelated stages and changes to started work',()=>{
 const input=fixture();
 for(const links of [[{source:'A',target:'A',type:'FS'}],[{source:'X',target:'B',type:'FS'}],[{source:'A',target:'B',type:'FS'},{source:'B',target:'A',type:'FS'}]])assert.throws(()=>planStageConnections(input,links));
 input[1].status='Completed';assert.throws(()=>planStageConnections(input,[{source:'A',target:'B',type:'SS'}]),/already started/);
 assert.notEqual(connectionFingerprint(input),connectionFingerprint(fixture()));
});
test('predecessor delay propagates through both incoming branches',()=>{
 const input=fixture();input[0].end='2026-10-10';const result=planStageConnections(input,[{source:'A',target:'B',type:'FS'},{source:'A',target:'C',type:'FS'},{source:'B',target:'C',type:'FS'}]);
 assert.equal(result.tasks[1].start,'2026-10-11');assert.equal(result.tasks[2].start,'2026-10-16');
});
