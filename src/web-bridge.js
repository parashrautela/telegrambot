import http from 'node:http';
import { loadTelegramAttachment } from './telegram-media.js';
import { timingSafeEqual } from 'node:crypto';
import { createProjectShell, assignWorkflowToProject } from './project-service.js';
import { getChatMember, sendMessage } from './telegram.js';

import { downloadProjectResource } from './drive-storage.js';
import { WORKFLOW_OPTIONS } from './schema.js';

const active = new Set(['creator', 'owner', 'administrator', 'member', 'restricted']);
const escape = (value) => String(value).replace(/[&<>]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[character]));
const respond = (res, code, data) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); };
const equal = (a, b) => { const left = Buffer.from(String(a)); const right = Buffer.from(String(b)); return left.length === right.length && timingSafeEqual(left, right); };
async function readBody(req) {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 50_000) throw new Error('Request too large.'); }
  return JSON.parse(raw || '{}');
}

export function startWebBridge({ store, token, founderTelegramId }) {
  const secret = process.env.INTEGRATION_SHARED_SECRET;
  if (!secret) return null;
  const port = Number(process.env.BOT_BRIDGE_PORT || process.env.PORT || 3001);
  const startingProjects = new Set();
  const replyingRequests = new Set();
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/health') return respond(res, 200, { ok: true });
      if (!equal((req.headers.authorization || '').replace(/^Bearer /i, ''), secret)) return respond(res, 401, { error: 'Integration authentication required.' });
      if(req.method==='POST' && req.url==='/api/integrations/web/tasks/sync') {
        const input=await readBody(req);const project=await store.projectForGroup(String(input.groupChatId || ''));
        if(!project || project.WebManaged!=='Yes')return respond(res,404,{error:'Web-managed project not found.'});
        const syncKey='tasks:'+project.ProjectID;
        if(startingProjects.has(syncKey))return respond(res,409,{error:'Task sync is in progress.'});
        startingProjects.add(syncKey);
        try {
        if(!Array.isArray(input.updates) || input.updates.length>200)return respond(res,400,{error:'Invalid task updates.'});
        const all=await store.rows('Tasks');
        const tasks=all.filter(task=>task.ProjectID===project.ProjectID);
        const updates=[];const seen=new Set();
        for(const item of input.updates){
          if(typeof item.taskId!=='string' || !/^[A-Za-z0-9_.-]{1,160}$/.test(item.taskId) || typeof item.title!=='string' || !item.title.trim() || item.title.length>200 || typeof item.stage!=='string' || item.stage.length>120 || !['Pending','In Progress','Issue Reported','Completed','Archived'].includes(item.status) || typeof item.deadline!=='string' || (item.deadline && (!/^\d{4}-\d{2}-\d{2}$/.test(item.deadline) || !Number.isFinite(Date.parse(item.deadline)) || new Date(item.deadline).toISOString().slice(0,10)!==item.deadline)))return respond(res,400,{error:'Invalid task fields.'});
          if(seen.has(item.taskId))return respond(res,400,{error:'Duplicate task update.'});seen.add(item.taskId);
          const existing=all.find(task=>task.TaskID===item.taskId);
          if(existing && existing.ProjectID!==project.ProjectID)return respond(res,409,{error:'Task belongs to another project.'});
          if(!existing && !/^WEB-[0-9a-f-]{36}$/.test(item.taskId))return respond(res,404,{error:'Workflow task not found.'});
          const assignee=item.assigneeTelegramId==='founder'?String(project.LeaderTelegramID || founderTelegramId):String(item.assigneeTelegramId || '');
          if(assignee && !/^\d+$/.test(assignee))return respond(res,400,{error:'Invalid task assignee.'});
          updates.push({existing,item,assignee});
        }
        if(!updates.length)return respond(res,200,{tasks});
        for(const {existing,item,assignee} of updates){
          const changes={TaskName:item.title,Stage:item.stage,Status:item.status,PlannedEnd:item.deadline,CurrentEnd:item.deadline,AssignedTelegramID:assignee,AssignedName:String(item.assigneeName || '').slice(0,100),LastUpdatedAt:new Date().toISOString(),LastUpdatedBy:String(founderTelegramId)};
          if(existing)await store.updateRow('Tasks',existing.rowNumber,changes);
          else {await store.append('Tasks',{TaskID:item.taskId,ProjectID:project.ProjectID,WorkflowID:'WEB-CUSTOM',Sequence:Math.max(0,...tasks.map(task=>Number(task.Sequence)||0))+10,...changes},{raw:true});tasks.push({TaskID:item.taskId,Sequence:Math.max(0,...tasks.map(task=>Number(task.Sequence)||0))+10});}
        }
        return respond(res,200,{tasks:await store.tasksForProject(project.ProjectID)});
        } finally { startingProjects.delete(syncKey); }
      }
      if (req.method === 'POST' && ['/api/integrations/web/decisions/content','/api/integrations/web/decisions/publish'].includes(req.url)) {
        const input = await readBody(req);
        const request = (await store.rows('DecisionRequests')).find(row => row.RequestID === input.requestId && String(row.GroupChatID) === String(input.groupChatId));
        if (!request) return respond(res,404,{error:'Request not found in the linked group.'});
        if (req.url.endsWith('/content')) {
          const attachments = JSON.parse(request.AttachmentsJSON || '[]');
          if (!Number.isInteger(input.attachmentIndex) || input.attachmentIndex < 0 || !attachments[input.attachmentIndex]) return respond(res,404,{error:'Attachment not found.'});
          const file = await loadTelegramAttachment(attachments[input.attachmentIndex],token);
          return respond(res,200,{bytes:file.bytes.toString('base64'),mime:file.mime,inline:file.inline});
        }
        const answer = typeof input.response === 'string' ? input.response.trim() : '';
        if (!answer || answer.length > 3000) return respond(res,400,{error:'Enter a response under 3,000 characters.'});
        if (request.PublishedMessageID) {
          if (request.Response === answer) return respond(res,200,{ok:true,result:{message_id:Number(request.PublishedMessageID)}});
          return respond(res,409,{error:'A different response was already published.'});
        }
        if (['Sending','Unknown'].includes(request.ReplyDeliveryStatus) || replyingRequests.has(request.RequestID)) return respond(res,409,{error:'Delivery is pending or uncertain. Check Telegram before sending again.'});
        if (request.Status === 'Done') return respond(res,409,{error:'This request is already done.'});
        replyingRequests.add(request.RequestID);
        try {
          await store.updateRow('DecisionRequests',request.rowNumber,{ReplyDeliveryStatus:'Sending',Response:answer});
          let result;
          try {
            const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:request.GroupChatID,text:answer,reply_parameters:{message_id:Number(request.SourceMessageID),allow_sending_without_reply:true}}),signal:AbortSignal.timeout(10000),redirect:'error'});
            result = await response.json();
            if (!response.ok || !result.ok) {
              const status = result.ok === false && response.status < 500 ? 'Failed' : 'Unknown';
              await store.updateRow('DecisionRequests',request.rowNumber,{ReplyDeliveryStatus:status});
              return respond(res,200,{ok:false,deliveryStatus:status});
            }
            if (!Number.isSafeInteger(result.result?.message_id) || result.result.message_id <= 0) throw new Error('Missing message ID');
          } catch {
            await store.updateRow('DecisionRequests',request.rowNumber,{ReplyDeliveryStatus:'Unknown'});
            return respond(res,200,{ok:false,deliveryStatus:'Unknown'});
          }
          await store.updateRow('DecisionRequests',request.rowNumber,{ReplyDeliveryStatus:'Sent',Status:'Published',PublishedMessageID:String(result.result.message_id),PublishedAt:new Date().toISOString()});
          return respond(res,200,{ok:true,result:{message_id:result.result.message_id}});
        } finally { replyingRequests.delete(request.RequestID); }
      }
      if(req.method==='POST' && req.url==='/api/integrations/web/groups')return respond(res,200,{groups:await store.groupSnapshot()});
      if (req.method === 'POST' && req.url === '/api/integrations/web/group-members') {
        const input = await readBody(req);
        const groupChatId = String(input.groupChatId || '');
        const telegramUserId = String(input.telegramUserId || '');
        const name = String(input.name || '').trim(); const role = String(input.role || '').trim();
        if (!/^-?\d+$/.test(groupChatId) || !/^\d+$/.test(telegramUserId) || !name || !role || name.length > 100 || role.length > 80) return respond(res, 400, { error: 'Invalid group member profile.' });
        const group = (await store.rows('GroupRegistry')).find((item) => String(item.GroupChatID) === groupChatId);
        if (!group) return respond(res, 404, { error: 'Telegram group not found.' });
        const membership = await getChatMember(token, groupChatId, telegramUserId);
        if (!active.has(membership.status)) return respond(res, 409, { error: 'This person is no longer in the Telegram group.' });
        const changed = await store.assignGroupRole({ groupChatId, telegramUserId, name, role });
        const project = await store.projectForGroup(groupChatId);
        if (project) {
          const onboarding = await store.onboardingForMember(project.ProjectID, telegramUserId);
          if (onboarding?.Status === 'Pending') await store.approveOnboarding(onboarding, { name, role, founderTelegramId });
          if (!onboarding) await store.append('MemberOnboarding', { OnboardingID: `ONB-WEB-${groupChatId}-${telegramUserId}`, ProjectID: project.ProjectID, GroupChatID: groupChatId, TelegramUserID: telegramUserId, TelegramName: membership.user?.first_name || name, JoinedAt: new Date().toISOString(), Status: 'Approved', AssignedName: name, AssignedRole: role, ApprovedAt: new Date().toISOString(), ApprovedByTelegramID: String(founderTelegramId) }, { raw: true });
          // Web-managed setup selects its plan in the web app, never the personal bot.
        }
        if (changed) await sendMessage(token, groupChatId, `✅ <b>${escape(name)}</b> is assigned as <b>${escape(role)}</b> for this project.`);
        return respond(res, 200, { ok: true, changed });
      }
      if (req.method === 'POST' && ['/api/integrations/web/resources','/api/integrations/web/resources/content'].includes(req.url)) {
        const input=await readBody(req);const project=await store.projectForGroup(String(input.groupChatId || ''));
        if(!project)return respond(res,404,{error:'Project not found.'});
        const files=(await store.rows('SubmittedResources')).filter((row)=>row.ProjectID===project.ProjectID);
        if(req.url.endsWith('/content')) {
          const file=files.find((row)=>row.SubmissionID===input.submissionId && row.DriveStatus==='Stored');
          if(!file)return respond(res,404,{error:'Stored file not found.'});
          const bytes=await downloadProjectResource(file.DriveFileID);
          return respond(res,200,{bytes:bytes.toString('base64'),mimeType:file.MimeType || 'application/octet-stream'});
        }
        return respond(res,200,{files});
      }
      if (req.method === 'POST' && req.url === '/api/integrations/web/workflows') {
        const templates = await store.rows('WorkflowTemplates');
        const workflows = WORKFLOW_OPTIONS.map((option) => {
          const rows = templates.filter((row) => row.WorkflowID === option.id).sort((a,b)=>Number(a.Sequence)-Number(b.Sequence));
          const stages = [];
          for (const row of rows) {
            let stage = stages.find((item)=>item.name === row.Stage);
            if (!stage) { stage = {name:row.Stage,durationDays:0,tasks:[]}; stages.push(stage); }
            stage.durationDays += Number(row.DurationDays) || 0; stage.tasks.push(row.TaskName);
          }
          return {id:option.id,name:option.label,description:option.description,stages,parallel:option.id==='RESIDENTIAL-INTERIOR-V1'};
        }).filter((workflow)=>workflow.stages.length);
        return respond(res,200,{workflows});
      }
      if (req.method === 'POST' && req.url === '/api/integrations/web/projects/start') {
        const input = await readBody(req); const groupChatId = String(input.groupChatId || '');
        if (startingProjects.has(groupChatId)) return respond(res,409,{error:'Project start is already in progress. Refresh shortly.'});
        startingProjects.add(groupChatId);
        try {
        const project = await store.projectForGroup(groupChatId);
        const option = WORKFLOW_OPTIONS.find((item)=>item.id === input.workflowId);
        if (!project || !option) return respond(res,404,{error:'Linked project or workflow not found.'});
        if (['Completed','Abandoned'].includes(project.Status)) return respond(res,409,{error:'This project is closed.'});
        await store.updateRow('Projects',project.rowNumber,{WebManaged:'Yes'});
        const roster = (await store.rows('GroupMembers')).filter((member)=>String(member.GroupChatID)===groupChatId && member.MembershipStatus==='Active');
        if (roster.length < 2 || roster.some((member)=>!member.AssignedName || !member.AssignedRole) || roster.filter((member)=>/\bclient\b/i.test(member.AssignedRole)).length!==1 || !roster.some((member)=>!/\b(client|founder)\b/i.test(member.AssignedRole))) return respond(res,409,{error:'Assign one client and at least one team member, and finish all member profiles first.'});
        let tasks = (await store.tasksForProject(project.ProjectID)).filter((task)=>!String(task.Status).startsWith('Archived') && task.WorkflowID!=='WEB-CUSTOM');
        if (tasks.length && tasks.some((task)=>task.WorkflowID!==option.id)) return respond(res,409,{error:'This project already has a different workflow.'});
        if (!tasks.length) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate || '') || !Number.isFinite(Date.parse(input.startDate)) || new Date(input.startDate).toISOString().slice(0,10)!==input.startDate) return respond(res,400,{error:'Enter a valid start date.'});
          await store.updateRow('Projects',project.rowNumber,{StartDate:input.startDate,WebManaged:'Yes'});
          await assignWorkflowToProject({store,project:{...project,StartDate:input.startDate},workflowId:option.id,actorTelegramId:founderTelegramId});
          tasks = (await store.tasksForProject(project.ProjectID)).filter((task)=>task.WorkflowID===option.id);
        }
        const expected = (await store.rows('WorkflowTemplates')).filter((row)=>row.WorkflowID===option.id);
        if (!expected.length || tasks.length!==expected.length || !expected.every((row)=>tasks.some((task)=>String(task.Sequence)===String(row.Sequence)))) return respond(res,409,{error:'The Telegram plan is incomplete. Repair it before starting the web workspace.'});
        const updated = await store.projectForGroup(groupChatId);
        let announcementStatus = updated.WorkflowAnnouncementStatus || '';
        if (!announcementStatus) {
          await store.updateRow('Projects',project.rowNumber,{WorkflowAnnouncementStatus:'Sending',WebManaged:'Yes'});
          try {
            await sendMessage(token,groupChatId,`<b>Project started — ${escape(option.label)}</b>\n\n${escape(project.ProjectName)} is now running the ${escape(option.label)} workflow. ${tasks.length} tasks have been generated.\n\nPlease share the project plans, reference photos and documents in this group. They will be saved automatically in the project's Files tab. Use /tasks to see the plan.`);
            announcementStatus='Sent';
          } catch { announcementStatus='Unknown'; }
          await store.updateRow('Projects',project.rowNumber,{WorkflowAnnouncementStatus:announcementStatus});
        }
        return respond(res,200,{projectId:project.ProjectID,workflowId:option.id,workflowName:option.label,tasks,announcementStatus:announcementStatus==='Sending'?'Unknown':announcementStatus});
        } finally { startingProjects.delete(groupChatId); }
      }
      if (req.method === 'POST' && req.url === '/api/integrations/web/projects') {
        const input = await readBody(req);
        const groupChatId = String(input.groupChatId || '');
        const name = String(input.projectName || '').trim();
        const clientName = String(input.clientName || '').trim();
        const startDate = String(input.startDate || '').trim();
        if (!/^-?\d+$/.test(groupChatId) || !name || !clientName || name.length > 120 || clientName.length > 100 || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return respond(res, 400, { error: 'Invalid project details.' });
        const group = (await store.rows('GroupRegistry')).find((item) => String(item.GroupChatID) === groupChatId);
        if (!group) return respond(res, 404, { error: 'Telegram group not found.' });
        let project = await store.projectForGroup(groupChatId);
        if (!project) {
          const ids = new Set((await store.rows('Projects')).map((item) => item.ProjectID));
          let number = 1; while (ids.has(`P${String(number).padStart(3, '0')}`)) number += 1;
          await createProjectShell({ store, projectId: `P${String(number).padStart(3, '0')}`, projectName: name, clientName, startDateText: startDate, groupChatId, leaderTelegramId: founderTelegramId });
          project = await store.projectForGroup(groupChatId);
          for (const member of (await store.rows('GroupMembers')).filter((item) => String(item.GroupChatID) === groupChatId && item.MembershipStatus === 'Active' && item.AssignedRole)) {
            if (await store.onboardingForMember(project.ProjectID, member.TelegramUserID)) continue;
            await store.append('MemberOnboarding', { OnboardingID: `ONB-WEB-${groupChatId}-${member.TelegramUserID}`, ProjectID: project.ProjectID, GroupChatID: groupChatId, TelegramUserID: member.TelegramUserID, TelegramName: member.TelegramName, JoinedAt: new Date().toISOString(), Status: 'Approved', AssignedName: member.AssignedName, AssignedRole: member.AssignedRole, ApprovedAt: new Date().toISOString(), ApprovedByTelegramID: String(founderTelegramId) }, { raw: true });
          }
          await store.updateRow('Projects', project.rowNumber, { WebManaged: 'Yes' });
          await sendMessage(token, groupChatId, `<b>Project created — ${escape(name)}</b>\n\nAdd the project members in Telegram, then assign their names and roles and choose the project type in the web app.`);
        }
        await store.updateRow('Projects',project.rowNumber,{WebManaged:'Yes'});
        return respond(res, 200, { projectId: project.ProjectID, projectName: project.ProjectName });
      }
      return respond(res, 404, { error: 'Not found.' });
    } catch (error) {
      console.error('Web bridge error:', error.message);
      return respond(res, error.status || 500, { error: error.status ? error.message : 'Could not complete the integration request.' });
    }
  });
  server.listen(port, () => console.log(`Web integration bridge listening on port ${port}.`));
  return server;
}
