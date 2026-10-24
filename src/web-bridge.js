import {sendTaskNotice} from './task-notice.js';
import {planStageConnections,connectionFingerprint} from './stage-connections.js';
import { rolesOf, hasRole, matchesRole, roleText, isStaff } from './roles.js';
import { refreshGroupMembers, activeMembership } from './group-discovery.js';
import http from 'node:http';
import { loadTelegramAttachment } from './telegram-media.js';
import { timingSafeEqual } from 'node:crypto';
import { createProjectShell, assignWorkflowToProject } from './project-service.js';
import { getChatMember, getMe, sendMessage } from './telegram.js';

import { downloadProjectResource } from './drive-storage.js';
import { BLANK_WORKFLOW_ID, WORKFLOW_OPTIONS } from './schema.js';
import { projectedFinish, rescheduleTasks, withForecastDefaults } from './workflow-engine.js';
import { STAGE_WORKFLOW_ID, buildStagePlan, defaultPlanStages, insertStageTask, editStageTask, renameStage, planTaskAction, scheduleSentence } from './stage-plan.js';

const escape = (value) => String(value).replace(/[&<>]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[character]));
const respond = (res, code, data) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); };
const equal = (a, b) => { const left = Buffer.from(String(a)); const right = Buffer.from(String(b)); return left.length === right.length && timingSafeEqual(left, right); };
async function readBody(req, maximum = 50_000) {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > maximum) throw new Error('Request too large.'); }
  return JSON.parse(raw || '{}');
}

const isoDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const effectiveStart = (task) => task.ForecastStart || task.CurrentStart || task.PlannedStart || '';
const effectiveEnd = (task) => task.ForecastEnd || task.CurrentEnd || task.PlannedEnd || '';

function parseMoves(input) {
  if (!Array.isArray(input) || !input.length || input.length > 60) return null;
  const seen = new Set();
  for (const move of input) {
    if (!move || typeof move.taskId !== 'string' || !/^[A-Za-z0-9_.-]{1,160}$/.test(move.taskId) || seen.has(move.taskId)) return null;
    if (!isoDate(move.start) || !isoDate(move.end)) return null;
    if ((move.fromStart !== undefined && move.fromStart !== '' && !isoDate(move.fromStart)) || (move.fromEnd !== undefined && move.fromEnd !== '' && !isoDate(move.fromEnd))) return null;
    seen.add(move.taskId);
  }
  return input.map(({ taskId, start, end, fromStart, fromEnd, forecastOnly }) => ({ taskId, start, end, fromStart, fromEnd, forecastOnly: forecastOnly === true }));
}

// Writes an engine result to the Tasks sheet in one batch. Moved tasks become the committed current plan;
// pushed successors change forecast only. Baseline planned dates are kept, and filled only when blank.
async function writeSchedule(store, project, rows, result, { actor, actorName, source }) {
  const byId = new Map(rows.map((row) => [row.TaskID, row]));
  const stamp = new Date().toISOString();
  const rowChanges = result.affected.map((item) => {
    const row = byId.get(item.taskId);
    const changes = { ForecastStart: item.forecastStart, ForecastEnd: item.forecastEnd, LastUpdatedAt: stamp, LastUpdatedBy: String(actor) };
    if (item.committed) Object.assign(changes, { CurrentStart: item.forecastStart, CurrentEnd: item.forecastEnd });
    if (item.committed && !row.PlannedStart && !row.PlannedEnd) Object.assign(changes, { PlannedStart: item.forecastStart, PlannedEnd: item.forecastEnd });
    return { rowNumber: row.rowNumber, changes };
  });
  await store.updateRows('Tasks', rowChanges);
  if (result.finish && result.finish !== project.TargetEndDate) await store.updateRow('Projects', project.rowNumber, { TargetEndDate: result.finish });
  const moved = result.affected.filter((item) => item.committed);
  if (!moved.length) return;
  await store.audit({
    projectId: project.ProjectID, taskId: moved.map((item) => item.taskId).join(','), action: 'Schedule changed',
    oldValue: moved.map((item) => `${item.taskId} ${item.previousStart || '?'}→${item.previousEnd || '?'}`).join('; '),
    newValue: moved.map((item) => `${item.taskId} ${item.forecastStart}→${item.forecastEnd}`).join('; '),
    actor, actorName, source,
    details: `${result.affected.length - moved.length} dependent task(s) also moved${result.finish ? `; projected finish ${result.finish}` : ''}${result.warnings.length ? `; warnings: ${result.warnings.map((warning) => warning.reason).join(' ')}` : ''}`,
  });
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
      if(req.method==='POST' && req.url==='/api/integrations/web/task-notice') {
        const input=await readBody(req,7_100_000);
        try { return respond(res,200,await sendTaskNotice({store,token,input})); }
        catch(error) { return respond(res,error.status || 502,{error:error.status ? error.message : 'Notification delivery was not confirmed.'}); }
      }
      if (req.method === 'POST' && req.url === '/api/integrations/web/projects/close') {
        const input = await readBody(req);
        if (!['Completed', 'Abandoned'].includes(input.outcome)) return respond(res, 400, { error: 'Choose Completed or Abandoned.' });
        const project = await store.projectForGroup(String(input.groupChatId || ''));
        if (!project && input.allowUnstarted === true) {
          const groupId = String(input.groupChatId || '');
          const registered = (await store.rows('GroupRegistry')).some((group) => String(group.GroupChatID) === groupId);
          if (!registered) return respond(res, 404, { error: 'The Telegram group is not registered with this bot.' });
          if (typeof input.projectName !== 'string' || !input.projectName.trim() || input.projectName.length > 120) return respond(res, 400, { error: 'Enter a project name.' });
          const key = 'closing-group:' + groupId;
          if (startingProjects.has(key)) return respond(res, 409, { error: 'This project is being closed. Please wait.' });
          startingProjects.add(key);
          try {
            let announcementStatus = 'Sent';
            try { await sendMessage(token, groupId, `<b>${escape(input.projectName.trim())}</b>\n\nThis project is now ${input.outcome.toLowerCase()}. The project history is retained.`); }
            catch { announcementStatus = 'Unknown'; }
            return respond(res, 200, { status: input.outcome, announcementStatus });
          } finally { startingProjects.delete(key); }
        }
        if (!project || project.WebManaged !== 'Yes') return respond(res, 404, { error: 'Linked web-managed project not found.' });
        const key = 'tasks:' + project.ProjectID;
        if (startingProjects.has(key)) return respond(res, 409, { error: 'A project change is being saved. Try again shortly.' });
        if (['Completed', 'Abandoned'].includes(project.Status)) {
          if (project.Status !== input.outcome) return respond(res, 409, { error: `This project is already ${project.Status.toLowerCase()}.` });
          return respond(res, 200, { status: project.Status, announcementStatus: 'Unknown', alreadyClosed: true });
        }
        startingProjects.add(key);
        try {
          await store.closeProject({ project, outcome: input.outcome, actorTelegramId: founderTelegramId, actorName: 'Founder', source: 'Web app' });
          let announcementStatus = 'Sent';
          try {
            await sendMessage(token, project.GroupChatID, `<b>${escape(project.ProjectName)}</b>\n\nThis project is now ${input.outcome.toLowerCase()}. The project history is retained.`);
          } catch { announcementStatus = 'Unknown'; }
          return respond(res, 200, { status: input.outcome, announcementStatus });
        } finally { startingProjects.delete(key); }
      }
      if(req.method==='POST' && req.url==='/api/integrations/web/tasks/sync') {
        const input=await readBody(req);const project=await store.projectForGroup(String(input.groupChatId || ''));
        if(!project || project.WebManaged!=='Yes')return respond(res,404,{error:'Web-managed project not found.'});
        const syncKey='tasks:'+project.ProjectID;
        if(startingProjects.has(syncKey))return respond(res,409,{error:'Task sync is in progress.'});
        startingProjects.add(syncKey);
        try {
        if(!Array.isArray(input.updates) || input.updates.length>200)return respond(res,400,{error:'Invalid task updates.'});
        if (input.updates.length && ['Completed', 'Abandoned'].includes(project.Status)) return respond(res,409,{error:'This project is closed.'});
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
        // Write only fields the web actually changed. Dates go through the engine so dependents move and the baseline survives.
        const fieldChanges=[];const moves=[];
        for(const {existing,item,assignee} of updates){
          const fields={TaskName:item.title,Stage:item.stage,Status:item.status,AssignedTelegramID:assignee,AssignedName:String(item.assigneeName || '').slice(0,100)};
          if(existing){
            const changes=Object.fromEntries(Object.entries(fields).filter(([field,value])=>String(existing[field] ?? '')!==String(value)));
            if(Object.keys(changes).length)fieldChanges.push({rowNumber:existing.rowNumber,changes:{...changes,LastUpdatedAt:new Date().toISOString(),LastUpdatedBy:String(founderTelegramId)}});
            // A blank web deadline never wipes sheet dates; only a real new end date reschedules.
            if(item.deadline && item.deadline!==effectiveEnd(existing)){
              const start=effectiveStart(existing) && effectiveStart(existing)<=item.deadline?effectiveStart(existing):item.deadline;
              moves.push({taskId:existing.TaskID,start,end:item.deadline});
            }
          }
          else {const sequence=Math.max(0,...tasks.map(task=>Number(task.Sequence)||0))+10;await store.append('Tasks',{TaskID:item.taskId,ProjectID:project.ProjectID,WorkflowID:'WEB-CUSTOM',Sequence:sequence,...fields,PlannedEnd:item.deadline,CurrentEnd:item.deadline,ForecastEnd:item.deadline,LastUpdatedAt:new Date().toISOString(),LastUpdatedBy:String(founderTelegramId)},{raw:true});tasks.push({TaskID:item.taskId,Sequence:sequence});}
        }
        await store.updateRows('Tasks',fieldChanges);
        if(moves.length){
          const rows=await store.tasksForProject(project.ProjectID);
          const result=rescheduleTasks(rows,moves,{enforce:false});
          await writeSchedule(store,project,rows,result,{actor:founderTelegramId,actorName:'Web app',source:'Web task edit'});
        }
        return respond(res,200,{tasks:await store.tasksForProject(project.ProjectID)});
        } finally { startingProjects.delete(syncKey); }
      }
      if (req.method === 'POST' && ['/api/integrations/web/schedule/preview', '/api/integrations/web/schedule/apply'].includes(req.url)) {
        const input = await readBody(req);
        const project = await store.projectForGroup(String(input.groupChatId || ''));
        if (!project) return respond(res, 404, { error: 'Linked project not found.' });
        if (['Completed', 'Abandoned'].includes(project.Status)) return respond(res, 409, { error: 'This project is closed.' });
        const moves = parseMoves(input.moves);
        if (!moves) return respond(res, 400, { error: 'Send 1 to 60 moves with a task ID and real YYYY-MM-DD start and end dates.' });
        const apply = req.url.endsWith('/apply');
        const lockKey = 'tasks:' + project.ProjectID;
        if (apply && startingProjects.has(lockKey)) return respond(res, 409, { error: 'Another schedule change is being saved. Try again in a moment.' });
        if (apply) startingProjects.add(lockKey);
        try {
          const rows = await store.tasksForProject(project.ProjectID);
          // Reject moves made from an out-of-date view, so two people cannot silently overwrite each other.
          const stale = moves.filter((move) => {
            const row = rows.find((item) => item.TaskID === move.taskId);
            return row && ((move.fromStart !== undefined && move.fromStart !== effectiveStart(row)) || (move.fromEnd !== undefined && move.fromEnd !== effectiveEnd(row)));
          });
          if (stale.length) return respond(res, 409, { error: 'The schedule changed since you opened it. Refresh and try again.', stale: stale.map((move) => move.taskId) });
          const result = rescheduleTasks(rows, moves);
          const summary = { ok: result.ok, conflicts: result.conflicts, warnings: result.warnings, affected: result.affected, finish: result.finish };
          if (!apply) return respond(res, 200, summary);
          if (!result.ok) return respond(res, 409, { ...summary, error: result.conflicts[0].reason });
          const actorName = String(input.actorName || 'Founder').slice(0, 100);
          await writeSchedule(store, project, rows, result, { actor: founderTelegramId, actorName, source: 'Web timeline' });
          return respond(res, 200, { ...summary, tasks: await store.tasksForProject(project.ProjectID) });
        } finally { if (apply) startingProjects.delete(lockKey); }
      }
      if (req.method === 'POST' && req.url === '/api/integrations/web/default-plan') {
        return respond(res, 200, { stages: defaultPlanStages() });
      }
      // Founder-built plans: add stages, add a task inside a stage, and delay/redo/complete a task.
      // Every route takes mode "preview" (nothing is written) or "apply".
      if (req.method === 'POST' && ['/api/integrations/web/stages/add', '/api/integrations/web/stages/insert-task', '/api/integrations/web/stages/rename', '/api/integrations/web/tasks/edit', '/api/integrations/web/tasks/action'].includes(req.url)) {
        const input = await readBody(req);
        const project = await store.projectForGroup(String(input.groupChatId || ''));
        if (!project) return respond(res, 404, { error: 'Linked project not found.' });
        if (['Completed', 'Abandoned'].includes(project.Status)) return respond(res, 409, { error: 'This project is closed.' });
        if (!['preview', 'apply'].includes(input.mode)) return respond(res, 400, { error: 'Choose preview or apply.' });
        const apply = input.mode === 'apply';
        const lockKey = 'tasks:' + project.ProjectID;
        if (apply && startingProjects.has(lockKey)) return respond(res, 409, { error: 'Another schedule change is being saved. Try again in a moment.' });
        if (apply) startingProjects.add(lockKey);
        try {
          const rows = await store.tasksForProject(project.ProjectID);
          const actorName = String(input.actorName || 'Founder').slice(0, 100);
          const groupMembers = (await store.rows('GroupMembers')).filter((member) => String(member.GroupChatID) === String(project.GroupChatID));
          const options = { projectId: project.ProjectID, groupMembers, lastUpdatedBy: founderTelegramId, today: new Date().toISOString().slice(0, 10) };
          const stamp = new Date().toISOString();
          const identify=task=>{if(task?.assigneeTelegramId==='founder')task.assigneeTelegramId=String(project.LeaderTelegramID || founderTelegramId);};
          identify(input);identify(input.task);for(const spec of (Array.isArray(input.stages)?input.stages:[input.stage]))for(const task of spec?.tasks || [])identify(task);

          if (req.url.endsWith('/stages/rename')) {
            const changes = renameStage(rows, input.stageName, input.name);
            if (apply) {
              await store.updateRows('Tasks', changes.map((item) => ({ ...item, changes: { ...item.changes, LastUpdatedAt: stamp, LastUpdatedBy: String(founderTelegramId) } })));
              await store.audit({ projectId: project.ProjectID, action: 'Stage renamed', oldValue: input.stageName, newValue: input.name, actor: founderTelegramId, actorName, source: 'Web timeline' });
            }
            return respond(res, 200, { ok: true, conflicts: [], warnings: [], affected: [], finish: projectedFinish(withForecastDefaults(rows)) });
          }
          if (req.url.endsWith('/tasks/edit')) {
            const edited = editStageTask(rows, input, options);
            const result = rescheduleTasks(edited.rows, edited.moves);
            const summary = { ok: result.ok, conflicts: result.conflicts, warnings: result.warnings, affected: result.affected, finish: result.finish };
            if (!apply) return respond(res, 200, summary);
            if (!result.ok) return respond(res, 409, { ...summary, error: result.conflicts[0].reason });
            await writeSchedule(store, project, rows, result, { actor: founderTelegramId, actorName, source: 'Web timeline' });
            await store.updateRows('Tasks', [{ rowNumber: edited.row.rowNumber, changes: { ...edited.changes, LastUpdatedAt: stamp, LastUpdatedBy: String(founderTelegramId) } }]);
            await store.audit({ projectId: project.ProjectID, taskId: edited.row.TaskID, action: 'Work item edited', oldValue: edited.row.TaskName, newValue: edited.changes.TaskName, actor: founderTelegramId, actorName, source: 'Web timeline' });
            return respond(res, 200, { ...summary, tasks: await store.tasksForProject(project.ProjectID) });
          }

          if (req.url.endsWith('/stages/add')) {
            const specs = Array.isArray(input.stages) ? input.stages : [input.stage];
            const plan = buildStagePlan(rows, specs, options);
            const finish = projectedFinish(withForecastDefaults([...rows, ...plan.rows]));
            const created = plan.rows.map((row) => ({ taskId: row.TaskID, title: row.TaskName, stage: row.Stage, start: row.ForecastStart, end: row.ForecastEnd, role: row.AssignedRole, assigneeName: row.AssignedName, status: row.Status }));
            const summary = { ok: true, conflicts: [], warnings: plan.warnings, stages: plan.stages, created, finish };
            if (!apply) return respond(res, 200, summary);
            await store.appendRows('Tasks', plan.rows);
            if (finish && finish !== project.TargetEndDate) await store.updateRow('Projects', project.rowNumber, { TargetEndDate: finish });
            await store.audit({ projectId: project.ProjectID, action: 'Stage added', newValue: plan.stages.map((stage) => stage.name).join(', '), actor: founderTelegramId, actorName, source: 'Web timeline', details: plan.stages.map((stage) => `${stage.name}: ${stage.startDate || '?'}→${stage.endDate || '?'}`).join('; ') });
            return respond(res, 200, { ...summary, tasks: await store.tasksForProject(project.ProjectID) });
          }

          if (req.url.endsWith('/stages/insert-task')) {
            const { row, rewire } = insertStageTask(rows, input.task || {}, options);
            const rewired = rows.map((task) => {
              const change = rewire.find((item) => item.taskId === task.TaskID);
              return change ? { ...task, PredecessorTaskIDs: change.PredecessorTaskIDs, PredecessorTaskID: change.PredecessorTaskID } : task;
            });
            const result = rescheduleTasks([...rewired, row], []);
            // The new row is appended, not updated, so it takes whatever dates the engine gave it.
            const placed = result.tasks.find((task) => task.TaskID === row.TaskID);
            if (placed?.ForecastStart) Object.assign(row, { ForecastStart: placed.ForecastStart, ForecastEnd: placed.ForecastEnd, PlannedStart: placed.ForecastStart, PlannedEnd: placed.ForecastEnd, BlockedReason: '' });
            result.affected = result.affected.filter((item) => item.taskId !== row.TaskID);
            const summary = { ok: result.ok, conflicts: result.conflicts, warnings: result.warnings, affected: result.affected, finish: result.finish, created: [{ taskId: row.TaskID, title: row.TaskName, stage: row.Stage, start: row.ForecastStart, end: row.ForecastEnd }] };
            if (!apply) return respond(res, 200, summary);
            if (!result.ok) return respond(res, 409, { ...summary, error: result.conflicts[0].reason });
            await store.appendRows('Tasks', [row]);
            await store.updateRows('Tasks', rewire.map((item) => ({ rowNumber: item.rowNumber, changes: { PredecessorTaskIDs: item.PredecessorTaskIDs, PredecessorTaskID: item.PredecessorTaskID, LastUpdatedAt: stamp, LastUpdatedBy: String(founderTelegramId) } })));
            await writeSchedule(store, project, rewired, result, { actor: founderTelegramId, actorName, source: 'Web timeline' });
            await store.audit({ projectId: project.ProjectID, taskId: row.TaskID, action: 'Task added to stage', newValue: row.TaskName, actor: founderTelegramId, actorName, source: 'Web timeline', details: `${row.ForecastStart || '?'}→${row.ForecastEnd || '?'}; ${result.affected.length} later task(s) moved` });
            return respond(res, 200, { ...summary, tasks: await store.tasksForProject(project.ProjectID) });
          }

          // tasks/action: the stale-view guard also makes a retried apply fail instead of delaying twice.
          const current = rows.find((task) => task.TaskID === input.taskId);
          if (current && ((input.fromStart !== undefined && input.fromStart !== effectiveStart(current)) || (input.fromEnd !== undefined && input.fromEnd !== effectiveEnd(current)))) {
            return respond(res, 409, { error: 'The schedule changed since you opened it. Refresh and try again.', stale: [current.TaskID] });
          }
          const plan = planTaskAction(rows, { taskId: String(input.taskId || ''), action: input.action, days: input.days }, { today: options.today });
          const result = rescheduleTasks(rows, plan.moves);
          const sentence = scheduleSentence(plan.summary, result.affected, result.finish);
          const summary = { ok: result.ok, conflicts: result.conflicts, warnings: result.warnings, affected: result.affected, finish: result.finish, summary: sentence };
          if (!apply) return respond(res, 200, summary);
          if (!result.ok) return respond(res, 409, { ...summary, error: result.conflicts[0].reason });
          // Dates first: the engine will not move a task that is already marked Completed.
          await writeSchedule(store, project, rows, result, { actor: founderTelegramId, actorName, source: 'Web query' });
          if (Object.keys(plan.statusChange).length) await store.updateRow('Tasks', plan.row.rowNumber, { ...plan.statusChange, LastUpdatedAt: stamp, LastUpdatedBy: String(founderTelegramId) });
          const action = { delay: 'Task delayed', redo: 'Task sent back for rework', complete: 'Task completed' }[input.action];
          await store.audit({ projectId: project.ProjectID, taskId: plan.row.TaskID, action, oldValue: `${effectiveStart(plan.row)}→${effectiveEnd(plan.row)} ${plan.row.Status}`, newValue: sentence, actor: founderTelegramId, actorName, source: 'Web query', details: String(input.note || '').slice(0, 500) });
          return respond(res, 200, { ...summary, tasks: await store.tasksForProject(project.ProjectID) });
        } finally { if (apply) startingProjects.delete(lockKey); }
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
      if(req.method==='POST' && req.url==='/api/integrations/web/stages/connections') {
        const input=await readBody(req),project=await store.projectForGroup(String(input.groupChatId || ''));
        if(!project || ['Completed','Abandoned'].includes(project.Status))return respond(res,409,{error:'Choose an active linked project.'});
        if(!['preview','apply'].includes(input.mode))return respond(res,400,{error:'Choose preview or apply.'});
        const lockKey='tasks:'+project.ProjectID;if(startingProjects.has(lockKey))return respond(res,409,{error:'A schedule change is already in progress.'});startingProjects.add(lockKey);
        try {
          const rows=(await store.tasksForProject(project.ProjectID)).filter(row=>!/^(Archived|Cancelled|Closed)/.test(row.Status));
          const normalized=rows.map(row=>({id:row.TaskID,stageId:row.Stage,title:row.TaskName,sequence:row.Sequence,start:effectiveStart(row),end:effectiveEnd(row),status:row.Status,actualStart:row.ActualStart,dependencies:(row.PredecessorTaskIDs || (row.PredecessorTaskID?row.PredecessorTaskID+':FS':'')).split(',').filter(Boolean).map(edge=>({id:edge.split(':')[0],type:edge.split(':')[1] || 'FS'}))}));
          const fingerprint=connectionFingerprint(normalized);
          if(input.mode==='apply' && input.fingerprint!==fingerprint)return respond(res,409,{error:'The schedule changed. Preview the connections again.'});
          const plan=planStageConnections(normalized,input.links);
          if(input.mode==='apply') {
            await store.updateRows('Tasks',plan.tasks.filter(task=>plan.changedIds.includes(task.id) || plan.affected.some(move=>move.taskId===task.id)).map(task=>{const row=rows.find(row=>row.TaskID===task.id);return {rowNumber:row.rowNumber,changes:{PredecessorTaskIDs:task.dependencies.map(edge=>edge.id+':'+edge.type).join(','),PredecessorTaskID:task.dependencies.find(edge=>edge.type==='FS')?.id || '',ForecastStart:task.start,ForecastEnd:task.end,CurrentStart:task.start,CurrentEnd:task.end,LastUpdatedAt:new Date().toISOString(),LastUpdatedBy:String(founderTelegramId)}};}));
            if(plan.finish)await store.updateRow('Projects',project.rowNumber,{TargetEndDate:plan.finish});
            await store.audit({projectId:project.ProjectID,action:'Stage connections updated',actor:founderTelegramId,actorName:input.actorName || 'Founder',source:'Web timeline',details:JSON.stringify(plan.links)});
          }
          return respond(res,200,{ok:true,affected:plan.affected,finish:plan.finish,links:plan.links,fingerprint,tasks:input.mode==='apply'?await store.tasksForProject(project.ProjectID):undefined});
        }finally{startingProjects.delete(lockKey);}
      }
      if(req.method==='POST' && req.url==='/api/integrations/web/work/snapshot') {
        const input=await readBody(req);
        if(!Array.isArray(input.groupChatIds) || input.groupChatIds.length>100 || input.groupChatIds.some(id=>!/^\-?\d+$/.test(String(id))))return respond(res,400,{error:'Invalid group snapshot request.'});
        const [projects,tasks]=await Promise.all([store.rows('Projects'),store.rows('Tasks')]);
        return respond(res,200,{projects:projects.filter(project=>input.groupChatIds.includes(String(project.GroupChatID))).map(project=>({groupChatId:String(project.GroupChatID),leaderTelegramId:String(project.LeaderTelegramID || founderTelegramId),tasks:tasks.filter(task=>task.ProjectID===project.ProjectID)}))});
      }
      if(req.method==='POST' && req.url==='/api/integrations/web/personal/profile')return respond(res,200,{username:(await getMe(token)).username});
      if(req.method==='POST' && req.url==='/api/integrations/web/personal/send') {
        const input=await readBody(req);
        if(!/^\d+$/.test(String(input.telegramUserId || '')) || typeof input.text!=='string' || !input.text.trim() || input.text.length>4000)return respond(res,400,{error:'Invalid personal task digest.'});
        if(!(await store.user(input.telegramUserId)))return respond(res,403,{error:'This Telegram user is not active.'});
        const message=await sendMessage(token,input.telegramUserId,escape(input.text));
        return respond(res,200,{messageId:message.message_id});
      }
      if(req.method==='POST' && req.url==='/api/integrations/web/supervisors/replace') {
        const input=await readBody(req);
        if(!Array.isArray(input.groups) || !input.groups.length || input.groups.length>100 || !/^\d+$/.test(String(input.toTelegramUserId || '')) || typeof input.toName!=='string' || !input.toName.trim() || input.toName.length>100)return respond(res,400,{error:'Invalid supervisor replacement.'});
        const changes=[];
        // Verify every target group before writing any group, so non-members never gain responsibility.
        for(const group of input.groups){
          const project=await store.projectForGroup(String(group.groupChatId));
          if(!project || ['Completed','Abandoned'].includes(project.Status))return respond(res,409,{error:'Choose active linked projects.'});
          const membership=await getChatMember(token,group.groupChatId,input.toTelegramUserId);
          if(!activeMembership(membership))return respond(res,409,{error:'Add the replacement to each selected Telegram group first.'});
          const rows=await store.tasksForProject(project.ProjectID);
          if(!Array.isArray(group.taskIds) || group.taskIds.some(id=>!rows.some(row=>row.TaskID===id)))return respond(res,400,{error:'Task does not belong to its selected project.'});
          changes.push({group,project,rows,membership});
        }
        for(const {group,rows,membership} of changes){
          await store.upsertGroupMember(group.groupChatId,membership.user,'Active');
          const previous=await store.groupMember(group.groupChatId,input.toTelegramUserId);
          await store.assignGroupRole({groupChatId:group.groupChatId,telegramUserId:input.toTelegramUserId,name:input.toName,role:roleText([...rolesOf(previous?.AssignedRole),'Site Supervisor'])});
          if(input.fromTelegramUserId){const old=await store.groupMember(group.groupChatId,input.fromTelegramUserId);if(old)await store.updateRow('GroupMembers',old.rowNumber,{AssignedRole:roleText(rolesOf(old.AssignedRole).filter(role=>!matchesRole(role,'Site Supervisor')))});}
          await store.updateRows('Tasks',rows.filter(row=>group.taskIds.includes(row.TaskID) && row.Status!=='Completed' && !/^(Archived|Cancelled|Closed)/.test(row.Status)).map(row=>({rowNumber:row.rowNumber,changes:{AssignedTelegramID:String(input.toTelegramUserId),AssignedName:input.toName,LastUpdatedAt:new Date().toISOString(),LastUpdatedBy:String(founderTelegramId)}})));
        }
        return respond(res,200,{ok:true});
      }
      if(req.method==='POST' && req.url==='/api/integrations/web/groups') {
        const input = await readBody(req);
        if (input.groupChatId && !/^-?\d+$/.test(String(input.groupChatId))) return respond(res,400,{error:'Invalid Telegram group ID.'});
        return respond(res,200,await refreshGroupMembers({store,token,groupChatId:input.groupChatId,telegramUserId:input.telegramUserId}));
      }
      if (req.method === 'POST' && req.url === '/api/integrations/web/group-members') {
        const input = await readBody(req);
        const groupChatId = String(input.groupChatId || '');
        const telegramUserId = String(input.telegramUserId || '');
        const name = String(input.name || '').trim(); const role = roleText(input.roles || input.role);
        if (!/^-?\d+$/.test(groupChatId) || !/^\d+$/.test(telegramUserId) || !name || !role || name.length > 100 || role.length > 160) return respond(res, 400, { error: 'Invalid group member profile.' });
        const group = (await store.rows('GroupRegistry')).find((item) => String(item.GroupChatID) === groupChatId);
        if (!group) return respond(res, 404, { error: 'Telegram group not found.' });
        const membership = await getChatMember(token, groupChatId, telegramUserId);
        if (!activeMembership(membership)) return respond(res, 409, { error: 'This person is no longer in the Telegram group.' });
        const changed = await store.assignGroupRole({ groupChatId, telegramUserId, name, role });
        const project = await store.projectForGroup(groupChatId);
        if (project) {
          const clients = (await store.rows('GroupMembers')).filter(member=>String(member.GroupChatID)===groupChatId && member.MembershipStatus==='Active' && hasRole(member.AssignedRole,'Client'));
          await store.updateRow('Projects',project.rowNumber,{ClientTelegramIDs:clients.map(member=>member.TelegramUserID).join(','),ClientTelegramID:clients[0]?.TelegramUserID || '',ClientName:clients.map(member=>member.AssignedName || member.TelegramName).join(', ')});
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
          return {id:option.id,name:option.label,description:option.description,stages,parallel:Boolean(option.parallel)};
        }).filter((workflow)=>workflow.stages.length || workflow.id===BLANK_WORKFLOW_ID);
        // Blank first: founders said most projects should start empty and grow stage by stage.
        workflows.sort((a,b)=>(b.id===BLANK_WORKFLOW_ID)-(a.id===BLANK_WORKFLOW_ID));
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
        if (roster.length < 2 || roster.some((member)=>!member.AssignedName || !member.AssignedRole) || !roster.some(member=>hasRole(member.AssignedRole,'Client')) || !roster.some(member=>isStaff(member.AssignedRole))) return respond(res,409,{error:'Assign at least one client and one team member, and finish all member profiles first.'});
        // Web-added stages and custom tasks are not a template, so they never count as "a different workflow".
        let tasks = (await store.tasksForProject(project.ProjectID)).filter((task)=>!String(task.Status).startsWith('Archived') && !['WEB-CUSTOM',STAGE_WORKFLOW_ID].includes(task.WorkflowID));
        if (tasks.length && tasks.some((task)=>task.WorkflowID!==option.id)) return respond(res,409,{error:'This project already has a different workflow.'});
        if (option.id === BLANK_WORKFLOW_ID) {
          // A blank project starts with no tasks; founders add stages from the web timeline.
          const startDate = input.startDate || project.StartDate;
          if (!isoDate(startDate)) return respond(res,400,{error:'Enter a valid start date.'});
          const client = roster.find((member)=>/\bclient\b/i.test(member.AssignedRole));
          if (project.Status !== 'Active' || project.StartDate !== startDate) await store.updateRow('Projects',project.rowNumber,{StartDate:startDate,Status:'Active',WebManaged:'Yes',ClientName:client.AssignedName,ClientTelegramID:String(client.TelegramUserID),ClientTelegramIDs:roster.filter(member=>hasRole(member.AssignedRole,'Client')).map(member=>member.TelegramUserID).join(','),Notes:'Blank plan started from the web app'});
          let announcementStatus = project.WorkflowAnnouncementStatus || '';
          if (!announcementStatus) {
            await store.updateRow('Projects',project.rowNumber,{WorkflowAnnouncementStatus:'Sending'});
            try {
              await sendMessage(token,groupChatId,`<b>Project started — ${escape(project.ProjectName)}</b>\n\nThe team will add stages as work is planned. Please share plans, reference photos and documents in this group. Use /query to ask the studio something and /update to share progress.`);
              announcementStatus='Sent';
            } catch { announcementStatus='Unknown'; }
            await store.updateRow('Projects',project.rowNumber,{WorkflowAnnouncementStatus:announcementStatus});
          }
          const stageTasks = (await store.tasksForProject(project.ProjectID)).filter((task)=>task.WorkflowID===STAGE_WORKFLOW_ID);
          return respond(res,200,{projectId:project.ProjectID,workflowId:option.id,workflowName:option.label,tasks:stageTasks,announcementStatus:announcementStatus==='Sending'?'Unknown':announcementStatus});
        }
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
        const clients=(await store.rows('GroupMembers')).filter(member=>String(member.GroupChatID)===groupChatId && member.MembershipStatus==='Active' && hasRole(member.AssignedRole,'Client'));
        await store.updateRow('Projects',project.rowNumber,{WebManaged:'Yes',ClientTelegramIDs:clients.map(member=>member.TelegramUserID).join(',')});
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
