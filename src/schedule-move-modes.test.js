import test from 'node:test';
import assert from 'node:assert/strict';
import {planMoveMode,moveFingerprint} from './schedule-move-modes.js';
const fixture=()=>[
  {id:'a',title:'Discovery',sequence:'10',start:'2026-10-26',end:'2026-10-27',status:'Open',dependencies:[]},
  {id:'b',title:'Planning',sequence:'20',start:'2026-10-28',end:'2026-10-30',status:'Open',dependencies:[{id:'a',type:'FS'}]},
  {id:'c',title:'Design',sequence:'30',start:'2026-10-31',end:'2026-11-03',status:'Open',dependencies:[{id:'b',type:'FS'}]},
  {id:'d',title:'Independent later stage',sequence:'40',start:'2026-11-04',end:'2026-11-05',status:'Open',dependencies:[]},
];
const move=(task,days)=>({taskId:task.id,fromStart:task.start,fromEnd:task.end,start:new Date(Date.parse(task.start)+days*86400000).toISOString().slice(0,10),end:new Date(Date.parse(task.end)+days*86400000).toISOString().slice(0,10)});
test('parallel moves only selected work and explicitly removes both boundary connections',()=>{
 const tasks=fixture(),before=structuredClone(tasks),result=planMoveMode(tasks,[move(tasks[1],-2)],'parallel');
 assert.equal(result.tasks[1].start,'2026-10-26');assert.equal(result.tasks[2].start,tasks[2].start);assert.equal(result.tasks[3].start,tasks[3].start);
 assert.deepEqual(result.tasks[1].dependencies,[]);assert.deepEqual(result.tasks[2].dependencies,[]);
 assert.equal(result.dependencyChanges.length,2);assert.equal(result.affected.length,1);assert.deepEqual(tasks,before);
});
test('shift following moves earlier and later work by the same offset, including independent later stages',()=>{
 for(const days of [-2,3]){
  const tasks=fixture(),result=planMoveMode(tasks,[move(tasks[1],days)],'shift-following');
  assert.equal(result.tasks[0].start,tasks[0].start);
  for(const task of result.tasks.slice(1))assert.equal(Date.parse(task.start)-Date.parse(tasks.find(row=>row.id===task.id).start),days*86400000);
  assert.deepEqual(result.tasks[2].dependencies,[{id:'b',type:'FS'}]);
  assert.equal(result.affected.filter(row=>!row.moved).length,2);
  assert.equal(result.dependencyChanges.length,days<0?1:0);
 }
});
test('a stage moves together while preserving internal FS and SS dependencies',()=>{
 const tasks=fixture();tasks[2].start='2026-10-28';tasks[2].dependencies=[{id:'b',type:'SS'}];
 const result=planMoveMode(tasks,[move(tasks[1],-1),move(tasks[2],-1)],'parallel');
 assert.deepEqual(result.tasks[2].dependencies,[{id:'b',type:'SS'}]);assert.equal(result.tasks[3].start,tasks[3].start);
});
test('started work, completed following work, stale dates, resize and mixed shifts cannot be overwritten',()=>{
 const tasks=fixture();
 assert.throws(()=>planMoveMode(tasks,[{...move(tasks[1],1),fromStart:'2026-10-20'}],'parallel'),/changed/);
 assert.throws(()=>planMoveMode(tasks,[{...move(tasks[1],1),end:'2026-11-02'}],'parallel'),/resizing/);
 assert.throws(()=>planMoveMode(tasks,[move(tasks[1],1),move(tasks[2],2)],'parallel'),/together/);
 assert.throws(()=>planMoveMode(tasks,[move(tasks[1],1)],'invalid'),/Choose/);
 tasks[2].status='Completed';
 assert.throws(()=>planMoveMode(tasks,[move(tasks[1],-1)],'shift-following'),/already started or finished/);
 tasks[1].actualStart='2026-10-28';
 assert.throws(()=>planMoveMode(tasks,[move(tasks[1],1)],'parallel'),/already started/);
});
test('preview fingerprint detects changes to a following task or connection',()=>{
 const tasks=fixture(),signature=moveFingerprint(tasks);
 tasks[3].end='2026-11-08';assert.notEqual(moveFingerprint(tasks),signature);
 tasks[3].end='2026-11-05';tasks[2].dependencies=[];assert.notEqual(moveFingerprint(tasks),signature);
});
