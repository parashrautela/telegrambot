import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { createProjectShell } from './project-service.js';
import { getChatMember, sendMessage } from './telegram.js';

const active = new Set(['creator', 'owner', 'administrator', 'member', 'restricted']);
const escape = (value) => String(value).replace(/[&<>]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[character]));
const respond = (res, code, data) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); };
const equal = (a, b) => { const left = Buffer.from(String(a)); const right = Buffer.from(String(b)); return left.length === right.length && timingSafeEqual(left, right); };
async function readBody(req) {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 50_000) throw new Error('Request too large.'); }
  return JSON.parse(raw || '{}');
}

export function startWebBridge({ store, token, founderTelegramId, onClientReady }) {
  const secret = process.env.INTEGRATION_SHARED_SECRET;
  if (!secret) return null;
  const port = Number(process.env.BOT_BRIDGE_PORT || process.env.PORT || 3001);
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/health') return respond(res, 200, { ok: true });
      if (!equal((req.headers.authorization || '').replace(/^Bearer /i, ''), secret)) return respond(res, 401, { error: 'Integration authentication required.' });
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
          if (/\bclient\b/i.test(role) && project.Status === 'Awaiting client plan') await onClientReady(project, name);
        }
        if (changed) await sendMessage(token, groupChatId, `✅ <b>${escape(name)}</b> is assigned as <b>${escape(role)}</b> for this project.`);
        return respond(res, 200, { ok: true, changed });
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
          await onClientReady(project, clientName);
        }
        return respond(res, 200, { projectId: project.ProjectID, projectName: project.ProjectName });
      }
      return respond(res, 404, { error: 'Not found.' });
    } catch (error) {
      console.error('Web bridge error:', error.message);
      return respond(res, 500, { error: 'Could not complete the integration request.' });
    }
  });
  server.listen(port, () => console.log(`Web integration bridge listening on port ${port}.`));
  return server;
}
