export async function captureStageReply(store,project,message){
 const tasks=await store.tasksForProject(project.ProjectID);
 const updates=await store.rows('TaskUpdates');
 const album=message.media_group_id && updates.find(row=>row.ProjectID===project.ProjectID && row.MediaGroupID===String(message.media_group_id));
 const task=tasks.find(t=>t.WorkflowID==='STAGE-SIX-V1' && ((message.reply_to_message?.message_id && String(t.TaskMessageID)===String(message.reply_to_message.message_id)) || (album && t.TaskID===album.TaskID)));
 if(!task)return false;
 const member=(await store.rows('GroupMembers')).find(m=>String(m.GroupChatID)===String(project.GroupChatID)&&String(m.TelegramUserID)===String(message.from?.id)&&m.MembershipStatus==='Active');
 if(!member?.AssignedRole)throw new Error('Finish your project member profile before posting task updates.');
 const updateId=`UPD-${project.GroupChatID}-${message.message_id}`;
 if(!updates.some(row=>row.UpdateID===updateId))await store.append('TaskUpdates',{UpdateID:updateId,ProjectID:project.ProjectID,TaskID:task.TaskID,GroupChatID:String(project.GroupChatID),SourceMessageID:String(message.message_id),TelegramUserID:String(message.from.id),Text:message.text||message.caption||'',SubmittedAt:new Date().toISOString(),MediaGroupID:String(message.media_group_id||'')},{raw:true});
 const revision=task.StepKey==='drawing'?String(Number(task.DrawingRevision||0)+1):String(tasks.find(t=>t.StageID===task.StageID && t.StepKey==='drawing')?.DrawingRevision||'');
 const photo=message.photo?.at(-1);const media=photo||message.document||message.video||message.audio||message.voice;
 if(media)await store.saveSubmittedResource({projectId:project.ProjectID,taskId:task.TaskID,groupChatId:project.GroupChatID,user:{id:message.from.id,name:member.AssignedName||member.TelegramName},resourceType:photo?'Photo':message.document?'Document':'Media',fileId:media.file_id,fileName:media.file_name||`task-${message.message_id}.${photo?'jpg':'bin'}`,caption:message.caption||'',sourceMessageId:message.message_id,revision,mimeType:media.mime_type||(photo?'image/jpeg':'application/octet-stream')});
 return true;
}
