export const SIX_STEPS = [
  {key:'site',name:'Site details and condition check',role:'Site Supervisor'},
  {key:'drawing',name:'Drawing preparation',role:'Designer'},
  {key:'internal',name:'Internal drawing approval',role:'Design Head',approval:true},
  {key:'client',name:'Client presentation and approval',role:'Client',approval:true},
  {key:'execution',name:'Site execution',role:'Contractor'},
  {key:'final',name:'Final check',role:'Design Head'},
];
const date = value => { if(!/^\d{4}-\d{2}-\d{2}$/.test(value || '') || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10)!==value)throw new Error('Enter a real YYYY-MM-DD date.');return new Date(value+'T00:00:00Z'); };
const format = value => value.toISOString().slice(0,10);
export function validateStageConfig(config,roster) {
  date(config.startDate);
  if(!['calendar','working'].includes(config.dayPolicy))throw new Error('Choose calendar or working days.');
  if(config.dayPolicy==='working' && (!Array.isArray(config.workingWeekdays) || !config.workingWeekdays.length || config.workingWeekdays.some(day=>!Number.isInteger(day)||day<0||day>6)))throw new Error('Choose the working weekdays.');
  if(!Array.isArray(config.stages) || !config.stages.length || config.stages.length>20)throw new Error('Choose between 1 and 20 stages.');
  const ids=new Set();for(const stage of config.stages){if(!/^[a-z0-9-]{1,30}$/.test(stage.id||'') || ids.has(stage.id) || !stage.name?.trim() || stage.name.length>100)throw new Error('Stage IDs and names must be unique and valid.');ids.add(stage.id);}
  for(const stage of config.stages){
    if(!Array.isArray(stage.dependsOn) || new Set(stage.dependsOn).size!==stage.dependsOn.length || stage.dependsOn.some(id=>!ids.has(id)||id===stage.id))throw new Error('Choose explicit valid stage dependencies.');
    for(const step of SIX_STEPS){
      if(!Number.isInteger(stage.durations?.[step.key]) || stage.durations[step.key]<1 || stage.durations[step.key]>365)throw new Error(`${stage.name}: confirm the duration for ${step.name}.`);
      const person=roster.find(member=>String(member.TelegramUserID)===String(stage.assignees?.[step.key]) && member.MembershipStatus==='Active');
      if(!person?.AssignedName || !person.AssignedRole)throw new Error(`${stage.name}: assign ${step.name} to an active member.`);
      if(step.key==='client' && !/\bclient\b/i.test(person.AssignedRole))throw new Error('Client approval must be assigned to the client.');
      if(!['client','site'].includes(step.key) && /\bclient\b/i.test(person.AssignedRole))throw new Error('Staff work must be assigned to a staff member.');
    }
  }
}
export function buildStageTasks(project,config,roster) {
  validateStageConfig(config,roster);
  const tasks=[],done=new Map(),visiting=new Set();
  const allowed=d=>config.dayPolicy==='calendar' || config.workingWeekdays.includes(d.getUTCDay());
  const next=value=>{const d=new Date(value);d.setUTCDate(d.getUTCDate()+1);while(!allowed(d))d.setUTCDate(d.getUTCDate()+1);return d;};
  const taskId=(stage,key)=>`${project.ProjectID}-S-${stage}-${key}`;
  function visit(stage){
    if(done.has(stage.id))return done.get(stage.id);
    if(visiting.has(stage.id))throw new Error('Stage dependencies contain a cycle.');visiting.add(stage.id);
    let cursor=date(config.startDate);while(!allowed(cursor))cursor=next(cursor);
    for(const id of stage.dependsOn){const end=visit(config.stages.find(s=>s.id===id));const start=next(end);if(start>cursor)cursor=start;}
    let previous='';
    SIX_STEPS.forEach((step,index)=>{
      let end=new Date(cursor);for(let d=1;d<stage.durations[step.key];d++)end=next(end);
      const person=roster.find(m=>String(m.TelegramUserID)===String(stage.assignees[step.key]));
      const dependencies=previous?[previous]:stage.dependsOn.map(id=>taskId(id,'final'));
      const id=taskId(stage.id,step.key);
      tasks.push({TaskID:id,ProjectID:project.ProjectID,WorkflowID:'STAGE-SIX-V1',TemplateVersion:'STAGE-SIX-V1',Sequence:String(config.stages.indexOf(stage)*100+index+1),Stage:stage.name,StageID:stage.id,StepKey:step.key,StepOrder:String(index+1),TaskName:step.name,AssignedTelegramID:String(person.TelegramUserID),AssignedName:person.AssignedName,AssignedRole:person.AssignedRole,Status:dependencies.length?'Waiting':'Ready',PredecessorTaskIDs:dependencies.map(id=>id+':FS').join(','),PredecessorTaskID:dependencies[0]||'',GateType:step.approval?'stage-approval':'',PlannedStart:format(cursor),PlannedEnd:format(end),ForecastStart:format(cursor),ForecastEnd:format(end),DrawingRevision:'0',ApprovedRevision:'',HoldReason:'',BeforeHoldStatus:'',TaskMessageID:'',NotificationState:'Pending'});
      previous=id;cursor=next(end);
    });
    const end=date(tasks.find(t=>t.StageID===stage.id && t.StepKey==='final').PlannedEnd);done.set(stage.id,end);visiting.delete(stage.id);return end;
  }
  for(const stage of config.stages)visit(stage);
  return tasks.sort((a,b)=>Number(a.Sequence)-Number(b.Sequence));
}
const predecessors = task => String(task.PredecessorTaskIDs||'').split(',').filter(Boolean).map(edge=>edge.split(':')[0]);
export function activateStageTasks(tasks){
  for(const task of tasks){if(task.Status!=='Waiting')continue;if(predecessors(task).every(id=>tasks.find(t=>t.TaskID===id)?.Status==='Completed'))task.Status=task.AssignedTelegramID?'Ready':'Needs assignment';}
  return tasks;
}
export function transitionStageTask(input,taskId,action,{actorId,founderId,reason='',today}={}){
  const tasks=input.map(t=>({...t})),task=tasks.find(t=>t.TaskID===taskId);if(!task || task.WorkflowID!=='STAGE-SIX-V1')throw new Error('Linked stage task not found.');
  const manager=String(actorId)===String(founderId),owner=String(actorId)===String(task.AssignedTelegramID);
  if(!actorId || (!owner && !(manager && ['hold','resume'].includes(action))))throw new Error('Only the assigned person can act on this task.');
  if(action==='hold'){
    if(!reason.trim())throw new Error('Enter a hold reason.');if(['Completed','Waiting'].includes(task.Status))throw new Error('Only active work can be held.');
    if(task.Status!=='On hold'){task.BeforeHoldStatus=task.Status;task.Status='On hold';}task.HoldReason=reason.trim().slice(0,1000);return tasks;
  }
  if(action==='resume'){
    if(task.Status!=='On hold')throw new Error('This task is not on hold.');task.Status=task.BeforeHoldStatus||'Ready';task.BeforeHoldStatus='';task.HoldReason='';return activateStageTasks(tasks);
  }
  if(task.Status==='Completed' && ['done','approve'].includes(action))return tasks;
  if(!['Ready','In Progress'].includes(task.Status))throw new Error('Finish predecessors or resume the task first.');
  if(!predecessors(task).every(id=>tasks.find(t=>t.TaskID===id)?.Status==='Completed'))throw new Error('A predecessor is incomplete.');
  const drawing=tasks.find(t=>t.StageID===task.StageID && t.StepKey==='drawing');
  if(action==='changes'){
    if(!['internal','client'].includes(task.StepKey) || !reason.trim())throw new Error('Approval changes require a reason.');
    drawing.Status='Ready';drawing.NotificationState='Pending';drawing.IssueText=reason.trim().slice(0,1000);
    for(const t of tasks.filter(t=>t.StageID===task.StageID && Number(t.StepOrder)>2)){t.Status='Waiting';t.ApprovedRevision='';t.NotificationState='Pending';}
    return tasks;
  }
  if(task.GateType==='stage-approval' && action!=='approve')throw new Error('Use Approve for an approval step.');
  if(task.GateType!=='stage-approval' && action!=='done')throw new Error('Use Complete for this step.');
  if(task.GateType==='stage-approval'){if(!drawing || drawing.Status!=='Completed' || Number(drawing.DrawingRevision)<1)throw new Error('A completed drawing revision is required.');task.ApprovedRevision=drawing.DrawingRevision;}
  if(task.StepKey==='execution'){
    const approvals=tasks.filter(t=>t.StageID===task.StageID && ['internal','client'].includes(t.StepKey));
    if(approvals.some(t=>t.Status!=='Completed' || t.ApprovedRevision!==drawing.DrawingRevision))throw new Error('Both approvals must match the current drawing revision.');
  }
  if(task.StepKey==='drawing')task.DrawingRevision=String(Number(task.DrawingRevision||0)+1);
  task.Status='Completed';task.ActualEnd=today||new Date().toISOString().slice(0,10);task.LastUpdatedBy=String(actorId);
  return activateStageTasks(tasks);
}

export function forecastStageTasks(tasks,config,today){
 date(today);const copies=tasks.map(t=>({...t})),byId=new Map(copies.map(t=>[t.TaskID,t])),visiting=new Set(),memo=new Map();
 const allowed=d=>config.dayPolicy==='calendar'||config.workingWeekdays.includes(d.getUTCDay());
 const next=d=>{const n=new Date(d);do{n.setUTCDate(n.getUTCDate()+1);}while(!allowed(n));return n;};
 function visit(task){
  if(memo.has(task.TaskID))return memo.get(task.TaskID);
  if(visiting.has(task.TaskID))throw new Error('Task dependency cycle.');visiting.add(task.TaskID);
  if(task.Status==='Completed'){const end=date(task.ActualEnd||task.PlannedEnd);memo.set(task.TaskID,end);visiting.delete(task.TaskID);return end;}
  if(task.Status==='On hold'){memo.set(task.TaskID,null);visiting.delete(task.TaskID);return null;}
  let start=date(config.startDate),blocked=false;
  for(const id of predecessors(task)){const before=byId.get(id);if(!before)throw new Error('Missing predecessor.');const end=visit(before);if(!end){blocked=true;break;}const anchor=next(end);if(anchor>start)start=anchor;}
  if(blocked){task.ForecastStart='';task.ForecastEnd='';task.BlockedReason='Waiting on held predecessor';memo.set(task.TaskID,null);visiting.delete(task.TaskID);return null;}
  if(['Ready','In Progress'].includes(task.Status)&&date(today)>start)start=date(today);
  while(!allowed(start))start=next(start);
  let end=new Date(start);const duration=config.stages.find(stage=>stage.id===task.StageID)?.durations?.[task.StepKey];
  if(!Number.isInteger(duration)||duration<1)throw new Error('Duration unconfirmed.');for(let i=1;i<duration;i++)end=next(end);
  task.ForecastStart=format(start);task.ForecastEnd=format(end);task.BlockedReason='';memo.set(task.TaskID,end);visiting.delete(task.TaskID);return end;
 }
 for(const task of copies)visit(task);return copies;
}
