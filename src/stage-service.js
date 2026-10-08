import {buildStageTasks,activateStageTasks,transitionStageTask,forecastStageTasks} from './stage-workflow.js';
import {sendMessage} from './telegram.js';
const locks=new Set();
const esc=value=>String(value||'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
export async function withStageLock(projectId,work){if(locks.has(projectId))throw new Error('A stage update is already in progress.');locks.add(projectId);try{return await work();}finally{locks.delete(projectId);}}
export async function startStageWorkflow(store,project,config){
 return withStageLock(project.ProjectID,async()=>{
  if(!project.LeaderTelegramID)throw new Error('Assign the project founder before starting linked stages.');
  if(['Completed','Abandoned'].includes(project.Status))throw new Error('This project is closed.');
  const roster=(await store.rows('GroupMembers')).filter(m=>String(m.GroupChatID)===String(project.GroupChatID));
  const generated=buildStageTasks(project,config,roster);
  const prior=await store.tasksForProject(project.ProjectID);
  if(prior.some(t=>t.WorkflowID!=='STAGE-SIX-V1' && !String(t.Status).startsWith('Archived')))throw new Error('Existing project work needs an explicit migration preview. Start this plan on a fresh project.');
  if(project.WorkflowConfigJSON && project.WorkflowConfigJSON!==JSON.stringify(config))throw new Error('This project already has a different linked plan.');
  await store.updateRow('Projects',project.rowNumber,{WorkflowConfigJSON:JSON.stringify(config),WebManaged:'Yes',Status:'Configuring linked workflow'});
  await store.appendRows('Tasks',generated.filter(task=>!prior.some(t=>t.TaskID===task.TaskID)));
  await store.updateRow('Projects',project.rowNumber,{Status:'Active',StartDate:config.startDate,TargetEndDate:generated.reduce((end,t)=>t.PlannedEnd>end?t.PlannedEnd:end,'')});
  return {founderTelegramId:String(project.LeaderTelegramID),workflowId:'STAGE-SIX-V1',workflowName:'Linked six-step stages',tasks:await store.tasksForProject(project.ProjectID),config};
 });
}
export async function actOnStageTask(store,project,taskId,action,input){
 return withStageLock(project.ProjectID,async()=>{
  const member=(await store.rows('GroupMembers')).find(m=>String(m.GroupChatID)===String(project.GroupChatID)&&String(m.TelegramUserID)===String(input.actorId)&&m.MembershipStatus==='Active');
  if(!member)throw new Error('Only an active project member can update linked tasks.');
  const tasks=await store.tasksForProject(project.ProjectID);
  const task=tasks.find(t=>t.TaskID===taskId);
  if(action==='done' && task?.StepKey==='drawing' && task.Status!=='Completed'){const revision=String(Number(task.DrawingRevision||0)+1);const files=await store.rows('SubmittedResources');if(!files.some(file=>file.ProjectID===project.ProjectID && file.TaskID===taskId && file.Revision===revision))throw new Error('Submit the current drawing revision before completing it.');}
  const transitioned=transitionStageTask(tasks,taskId,action,{actorId:input.actorId,founderId:project.LeaderTelegramID,reason:input.reason,today:new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'})});
  const next=forecastStageTasks(transitioned,JSON.parse(project.WorkflowConfigJSON),new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'}));
  const changes=[];
  for(const updated of next){const original=tasks.find(t=>t.TaskID===updated.TaskID);const fields={};for(const [key,value]of Object.entries(updated))if(key!=='rowNumber'&&value!==original[key])fields[key]=value;if(Object.keys(fields).length)changes.push({rowNumber:original.rowNumber,changes:fields});}
  if(changes.length)await store.updateRows('Tasks',changes);
  await store.audit({projectId:project.ProjectID,taskId,action:'Stage '+action,actor:input.actorId,actorName:input.actorName||'',source:'Linked workflow',details:input.reason||''});
  return {tasks:next};
 });
}
// Claim before sending. Interrupted or uncertain sends are never automatically replayed.
export async function dispatchStageHandoffs(store,project,token){
 return withStageLock(project.ProjectID,async()=>{
  const tasks=await store.tasksForProject(project.ProjectID);
  const activated=activateStageTasks(tasks.map(t=>({...t})));
  const activation=activated.filter(t=>t.Status!==tasks.find(p=>p.TaskID===t.TaskID).Status).map(t=>({rowNumber:t.rowNumber,changes:{Status:t.Status}}));
  if(activation.length)await store.updateRows('Tasks',activation);
  const roster=await store.rows('GroupMembers');
  const resources=await store.rows('SubmittedResources');
  for(const task of activated.filter(t=>t.WorkflowID==='STAGE-SIX-V1'&&t.Status==='Ready'&&t.NotificationState==='Pending')){
   const person=roster.find(m=>String(m.GroupChatID)===String(project.GroupChatID)&&String(m.TelegramUserID)===String(task.AssignedTelegramID)&&m.MembershipStatus==='Active');
   if(!person){await store.updateRow('Tasks',task.rowNumber,{Status:'Needs assignment',BlockedReason:'Assigned member is no longer active'});continue;}
   await store.updateRow('Tasks',task.rowNumber,{NotificationState:'Sending'});
   const before=activated.filter(t=>String(task.PredecessorTaskIDs||'').split(',').some(id=>id.startsWith(t.TaskID+':')));
   const drawing=activated.find(t=>t.StageID===task.StageID&&t.StepKey==='drawing');
   const documentIds=new Set([...before.map(t=>t.TaskID),drawing?.TaskID]);
   const documents=resources.filter(file=>file.ProjectID===project.ProjectID && documentIds.has(file.TaskID) && (file.TaskID!==drawing?.TaskID || file.Revision===drawing.DrawingRevision));
   const documentText=documents.length?'\nPrevious documents:\n'+documents.map(file=>esc(file.FileName)+' · '+esc(file.DriveStatus||'Pending')).join('\n'):'';
   const text=`<b>${esc(project.ProjectName)} — ${esc(task.Stage)}</b>\nStep ${esc(task.StepOrder)}/6: <b>${esc(task.TaskName)}</b>\nAssigned: <a href="tg://user?id=${task.AssignedTelegramID}">${esc(person.AssignedName)}</a>\nTask: <code>${esc(task.TaskID)}</code>\nDue: ${esc(task.ForecastEnd||task.PlannedEnd||'Not scheduled')}\n${before.length?'Previous step: '+before.map(t=>esc(t.TaskName)).join(', ')+'\n':''}\nReply to this message with this task’s photos, documents or updates.${documentText}\nUse /hold ${esc(task.TaskID)} reason to pause work.${task.GateType?'\nUse /changes '+esc(task.TaskID)+' reason to request a revised drawing.':''}`;
   const action=task.GateType?'approve':'done';const callback=`stage:${action}:${task.TaskID}`;
   if(Buffer.byteLength(callback)>64)throw new Error('Task ID exceeds the Telegram action limit.');
   let sent;
   try{sent=await sendMessage(token,project.GroupChatID,text,{inline_keyboard:[[{text:task.GateType?'Approve':'Complete',callback_data:callback}]]},documents.at(-1)?.SourceMessageID?{reply_parameters:{message_id:Number(documents.at(-1).SourceMessageID),allow_sending_without_reply:true}}:{});}
   catch{await store.updateRow('Tasks',task.rowNumber,{NotificationState:'Unknown'});continue;}
   // If persistence fails after Telegram accepted, keep Sending to prevent duplicates.
   await store.updateRow('Tasks',task.rowNumber,{NotificationState:'Sent',TaskMessageID:String(sent.message_id)});
  }
 });
}
