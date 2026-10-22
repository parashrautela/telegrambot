const DAY=86400000;
const fail=message=>{throw Object.assign(new Error(message),{status:409});};
export function stageLinksFor(tasks) {
 const byId=new Map(tasks.map(task=>[task.id,task])),links=new Map();
 for(const task of tasks)for(const edge of task.dependencies || []){const from=byId.get(edge.id);if(from && from.stageId!==task.stageId){const link={source:from.stageId,target:task.stageId,type:edge.type || 'FS'};links.set(`${link.source}:${link.target}:${link.type}`,link);}}
 return [...links.values()].sort((a,b)=>`${a.source}:${a.target}:${a.type}`.localeCompare(`${b.source}:${b.target}:${b.type}`));
}
export const connectionFingerprint=tasks=>JSON.stringify(tasks.map(task=>({id:task.id,stageId:task.stageId,start:task.start,end:task.end,status:task.status,dependencies:task.dependencies || []})).sort((a,b)=>a.id.localeCompare(b.id)));
export function planStageConnections(input,links) {
 if(!Array.isArray(links) || links.length>500)fail('Choose at most 500 stage connections.');
 const tasks=structuredClone(input),byId=new Map(tasks.map(task=>[task.id,task])),groups=new Map();
 for(const task of tasks){if(!task.stageId)continue;const group=groups.get(task.stageId) || [];group.push(task);groups.set(task.stageId,group);}
 for(const group of groups.values())group.sort((a,b)=>(Number(a.sequence)||0)-(Number(b.sequence)||0) || String(a.start).localeCompare(String(b.start)) || a.id.localeCompare(b.id));
 const unique=new Set();
 for(const link of links){if(!groups.has(link.source) || !groups.has(link.target) || link.source===link.target || !['FS','SS'].includes(link.type))fail('Choose distinct existing stages and a supported connection.');const key=`${link.source}:${link.target}:${link.type}`;if(unique.has(key))fail('This connection already exists.');unique.add(key);}
 const beforeLinks=stageLinksFor(input),incoming=id=>links.filter(link=>link.target===id),ordered=[],visiting=new Set(),visited=new Set();
 const visit=id=>{if(visiting.has(id))fail('Stage connections cannot form a cycle.');if(visited.has(id))return;visiting.add(id);for(const link of incoming(id))visit(link.source);visiting.delete(id);visited.add(id);ordered.push(id);};
 for(const id of groups.keys())visit(id);
 const signature=list=>JSON.stringify(list.map(link=>`${link.source}:${link.type}`).sort());
 const changedTargets=new Set([...groups.keys()].filter(id=>signature(incoming(id))!==signature(beforeLinks.filter(link=>link.target===id))));
 for(const task of tasks)task.dependencies=(task.dependencies || []).filter(edge=>!byId.has(edge.id) || byId.get(edge.id).stageId===task.stageId);
 for(const link of links){const from=groups.get(link.source),target=groups.get(link.target)[0];const anchor=link.type==='SS'?from[0]:[...from].sort((a,b)=>String(a.end).localeCompare(String(b.end))).at(-1);target.dependencies.push({id:anchor.id,type:link.type});}
 const original=new Map(input.map(task=>[task.id,task]));
 for(const id of ordered){
  const group=groups.get(id),edges=incoming(id);
  if(changedTargets.has(id) && group.some(task=>task.actualStart || ['Completed','In progress','In Progress','On hold'].includes(task.status)))fail('Connections of work that has already started cannot be changed.');
  if(!edges.length)continue;
  if(group.some(task=>!task.start || !task.end || !Number.isFinite(Date.parse(task.start)) || !Number.isFinite(Date.parse(task.end))))fail('Set stage dates before changing its connections.');
  const anchors=edges.map(link=>{const from=groups.get(link.source);if(from.some(task=>!task.start || !task.end))fail('Set predecessor stage dates first.');return link.type==='SS'?Math.min(...from.map(task=>Date.parse(task.start))):Math.max(...from.map(task=>Date.parse(task.end)))+DAY;});
  const current=Math.min(...group.map(task=>Date.parse(task.start))),earliest=Math.max(...anchors),next=changedTargets.has(id)?earliest:Math.max(current,earliest),shift=next-current;
  if(shift && group.some(task=>task.actualStart || ['Completed','In progress','In Progress','On hold'].includes(task.status)))fail('This change would move work that has already started.');
  for(const task of group){task.start=new Date(Date.parse(task.start)+shift).toISOString().slice(0,10);task.end=new Date(Date.parse(task.end)+shift).toISOString().slice(0,10);}
 }
 const affected=tasks.filter(task=>{const before=original.get(task.id);return before.start!==task.start || before.end!==task.end;}).map(task=>({taskId:task.id,taskName:task.title || task.id,previousStart:original.get(task.id).start,previousEnd:original.get(task.id).end,forecastStart:task.start,forecastEnd:task.end,committed:true}));
 const changed=tasks.filter(task=>JSON.stringify(original.get(task.id).dependencies || [])!==JSON.stringify(task.dependencies));
 if(changed.some(task=>task.actualStart || ['Completed','In progress','In Progress','On hold'].includes(task.status)))fail('Dependencies of work that has already started cannot be changed.');
 return {ok:true,conflicts:[],warnings:[],tasks,affected,changedIds:changed.map(task=>task.id),links,finish:tasks.some(task=>!task.end)?'':tasks.map(task=>task.end).sort().at(-1) || ''};
}
