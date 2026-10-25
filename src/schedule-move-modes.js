import { createHash } from 'node:crypto';

const DAY = 86400000;
const fail = message => { throw Object.assign(new Error(message), {status:409}); };
const date = value => {
  const time=Date.parse(value);
  if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(time) || new Date(time).toISOString().slice(0,10)!==value)fail('Every moved task needs valid dates.');
  return time;
};
const locked = task => Boolean(task.actualStart) || /^(Completed|Done|In progress|On hold|Issue Reported)$/i.test(task.status || '');
export const moveFingerprint = tasks => createHash('sha256').update(JSON.stringify([...tasks].sort((a,b)=>a.id.localeCompare(b.id)))).digest('hex');

// Both services use the same normalized planner so preview, persistence and the sheet agree.
export function planMoveMode(input, moves, mode) {
  if(!['parallel','shift-following'].includes(mode))fail('Choose move in parallel or shift everything after it.');
  if(!Array.isArray(moves) || !moves.length || moves.length>60)fail('Choose 1 to 60 tasks to move.');
  const tasks=structuredClone(input), byId=new Map(tasks.map(task=>[task.id,task]));
  const selected=new Set();let delta;
  for(const move of moves){
    const task=byId.get(move.taskId);
    if(!task || selected.has(task.id))fail('Choose distinct existing tasks in this project.');
    if(move.fromStart!==task.start || move.fromEnd!==task.end)fail('The schedule changed. Preview this move again.');
    const shift=date(move.start)-date(task.start);
    if(date(move.end)-date(task.end)!==shift || (delta!==undefined && delta!==shift) || move.forecastOnly)fail('These options require tasks to move together without resizing.');
    delta=shift;selected.add(task.id);
  }
  if(!delta)fail('Choose a different date.');
  const roots=tasks.filter(task=>selected.has(task.id));
  const ordered=tasks.every(task=>Number.isFinite(Number(task.sequence)) && Number(task.sequence)>0);
  const boundary=Math.min(...roots.map(task=>ordered?Number(task.sequence):date(task.start)));
  const moving=new Set(tasks.filter(task=>selected.has(task.id) || (mode==='shift-following' && (ordered?Number(task.sequence)>=boundary:task.start && date(task.start)>=boundary))).map(task=>task.id));
  for(const task of tasks)if(moving.has(task.id)){
    if(locked(task))fail(`${task.title} has already started or finished and cannot be moved.`);
    task.start=new Date(date(task.start)+delta).toISOString().slice(0,10);
    task.end=new Date(date(task.end)+delta).toISOString().slice(0,10);
  }
  const dependencyChanges=[];
  for(const task of tasks){
    const previous=task.dependencies || [], removed=[];
    task.dependencies=previous.filter(edge=>{
      const predecessor=byId.get(edge.id);
      if(!predecessor || moving.has(predecessor.id)===moving.has(task.id))return true;
      const violates=task.start && (edge.type==='SS'?predecessor.start:predecessor.end) && date(task.start)<date(edge.type==='SS'?predecessor.start:predecessor.end)+(edge.type==='SS'?0:DAY);
      if(mode==='parallel' || violates){
        if(locked(task))fail(`${task.title} has already started; its dependencies cannot change.`);
        removed.push(edge);return false;
      }
      return true;
    });
    if(removed.length)dependencyChanges.push({taskId:task.id,taskName:task.title,previous,dependencies:task.dependencies,reason:`${task.title} will no longer wait for ${removed.map(edge=>byId.get(edge.id)?.title || edge.id).join(', ')}.`});
  }
  const original=new Map(input.map(task=>[task.id,task]));
  const affected=tasks.filter(task=>moving.has(task.id)).map(task=>({taskId:task.id,taskName:task.title,moved:selected.has(task.id),committed:true,previousStart:original.get(task.id).start,previousEnd:original.get(task.id).end,forecastStart:task.start,forecastEnd:task.end}));
  return {ok:true,conflicts:[],warnings:[],tasks,affected,dependencyChanges,fingerprint:moveFingerprint(input),finish:tasks.some(task=>!task.end)?'':tasks.map(task=>task.end).sort().at(-1) || ''};
}
