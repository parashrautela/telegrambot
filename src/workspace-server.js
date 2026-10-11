import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkspaceStore, WorkspaceError } from './workspace-store.js';
import { deliverReply } from './workspace-delivery.js';

const json = (res, status, data) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
};
const equal = (left, right) => {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};
const tokenFrom = (req) => req.headers.cookie?.split(';').map((c) => c.trim()).find((c) => c.startsWith('iksha_session='))?.slice('iksha_session='.length) || '';
const body = async (req) => {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new WorkspaceError('Send application/json.', 415);
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > 65000) throw new WorkspaceError('Request is too large.', 413);
  }
  try {
    const value = JSON.parse(raw || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new WorkspaceError('Invalid JSON request.'); }
};

export function createWorkspaceServer({ store, origin = '', secureCookies = false, integrationSecret = '', groupToken = '', staticDirectory = resolve('frontend/dist') }) {
  const attempts = new Map();
  const cookie = (token, expire = false) => `iksha_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${expire ? 0 : 43200}${secureCookies ? '; Secure' : ''}`;
  const server = http.createServer(async (req, res) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('x-frame-options', 'DENY');
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && path === '/health') return json(res, 200, { ok: true });
      if (path === '/api/integrations/telegram/requests' && req.method === 'POST') {
        if (!integrationSecret || !equal((req.headers.authorization || '').replace(/^Bearer /i, ''), integrationSecret)) throw new WorkspaceError('Integration authentication required.', 401);
        return json(res, 200, store.telegramRequest(await body(req)));
      }
      if (path.startsWith('/api/')) {
        // Browser mutations require JSON and a matching origin. Integration uses its own bearer secret.
        if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin && req.headers.origin !== (origin || `http://${req.headers.host}`)) throw new WorkspaceError('Origin is not allowed.', 403);
        if (path === '/api/workspace/login' && req.method === 'POST') {
          const address = req.socket.remoteAddress || 'unknown';
          const time = Date.now();
          for (const [key, value] of attempts) if (value.expiresAt < time) attempts.delete(key);
          const attempt = attempts.get(address) || { count: 0, expiresAt: time + 900000 };
          if (attempt.count >= 15) throw new WorkspaceError('Too many sign-in attempts. Try again in 15 minutes.', 429);
          attempt.count += 1; attempts.set(address, attempt);
          const input = await body(req);
          const login = store.login(input.id, input.password);
          attempts.delete(address);
          res.setHeader('set-cookie', cookie(login.token));
          return json(res, 200, { user: login.user });
        }
        const token = tokenFrom(req);
        const user = store.authenticate(token);
        if (path === '/api/workspace/logout' && req.method === 'POST') {
          await body(req); store.logout(token);
          res.setHeader('set-cookie', cookie('', true));
          return json(res, 200, { ok: true });
        }
        if (path === '/api/workspace' && req.method === 'GET') return json(res, 200, store.snapshot(user));
        if (path === '/api/workspace/users' && req.method === 'POST') return json(res, 201, store.createUser(user, await body(req)));
        if (path === '/api/workspace/clients' && req.method === 'POST') return json(res, 201, store.createClient(user, await body(req)));
        if (path === '/api/workspace/projects' && req.method === 'POST') return json(res, 201, store.createProject(user, await body(req)));
        let match;
        if ((match = path.match(/^\/api\/workspace\/tasks\/([^/]+)\/history$/)) && req.method === 'GET') {
          const task = store.task(user, match[1]); const cursor = Number(new URL(req.url, 'http://localhost').searchParams.get('before') || Number.MAX_SAFE_INTEGER);
          if (!Number.isSafeInteger(cursor) || cursor < 1) throw new WorkspaceError('Invalid history cursor.');
          return json(res, 200, store.all("SELECT * FROM events WHERE projectId=? AND (taskId=? OR (taskId IS NULL AND kind='Project started')) AND seq<? ORDER BY seq DESC LIMIT 30", task.projectId, task.id, cursor));
        }
        if ((match = path.match(/^\/api\/workspace\/requests\/([^/]+)\/attachments\/(\d+)$/)) && req.method === 'GET') {
          const request = store.get('SELECT * FROM requests WHERE id=?', decodeURIComponent(match[1]));
          if (!request) throw new WorkspaceError('Attachment not found.', 404);
          store.project(user, request.projectId);
          if (user.role !== 'Founder' && !request.taskId) throw new WorkspaceError('Attachment not found.', 404);
          const attachment = JSON.parse(request.attachments)[Number(match[2])];
          if (!attachment?.fileId || !groupToken) throw new WorkspaceError('Telegram media is not available. Check the original group.', 404);
          const info = await fetch(`https://api.telegram.org/bot${groupToken}/getFile`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ file_id: attachment.fileId }), signal: AbortSignal.timeout(10000) });
          const file = await info.json();
          if (!file.ok || !file.result?.file_path || file.result.file_size > 10000000) throw new WorkspaceError('Attachment is unavailable or larger than 10 MB.', 400);
          const media = await fetch(`https://api.telegram.org/file/bot${groupToken}/${file.result.file_path}`, { signal: AbortSignal.timeout(15000) });
          if (!media.ok || Number(media.headers.get('content-length') || 0) > 10000000) throw new WorkspaceError('Could not load attachment.', 400);
          const chunks = []; let size = 0;
          for await (const chunk of media.body) { size += chunk.length; if (size > 10000000) throw new WorkspaceError('Attachment is larger than 10 MB.', 400); chunks.push(Buffer.from(chunk)); }
          const type = media.headers.get('content-type') || 'application/octet-stream';
          res.writeHead(200, { 'content-type': ['image/jpeg', 'image/png', 'image/webp'].includes(type) ? type : 'application/octet-stream', 'cache-control': 'private, no-store', 'content-disposition': ['image/jpeg', 'image/png', 'image/webp'].includes(type) ? 'inline' : 'attachment' });
          return res.end(Buffer.concat(chunks));
        }
        if ((match = path.match(/^\/api\/workspace\/interventions\/([^/]+)(?:\/(backtrack|action|replies))?$/))) {
          if (match[2] === 'backtrack' && req.method === 'GET') return json(res, 200, store.backtrack(user, match[1]));
          if (match[2] === 'action' && req.method === 'POST') { store.handleIntervention(user, match[1], await body(req)); return json(res, 200, { ok: true }); }
          if (match[2] === 'replies' && req.method === 'POST') {
            const reply = store.queueReply(user, match[1], await body(req));
            await deliverReply(store, reply.id, groupToken);
            return json(res, 200, store.get('SELECT * FROM replies WHERE id=?', reply.id));
          }
        }
        if ((match = path.match(/^\/api\/workspace\/replies\/([^/]+)\/reconcile$/)) && req.method === 'POST') { store.reconcileReply(user, match[1], await body(req)); return json(res, 200, { ok: true }); }
        if ((match = path.match(/^\/api\/workspace\/replies\/([^/]+)\/retry$/)) && req.method === 'POST') {
          await body(req); const reply = store.get('SELECT * FROM replies WHERE id=?', match[1]);
          if (!reply) throw new WorkspaceError('Reply not found.', 404);
          store.intervention(user, reply.interventionId);
          if (reply.state !== 'Failed') throw new WorkspaceError('Only a definitively failed reply can be retried.', 409);
          store.run("UPDATE replies SET state='Queued',error='' WHERE id=?", reply.id);
          await deliverReply(store, reply.id, groupToken); return json(res, 200, store.get('SELECT * FROM replies WHERE id=?', reply.id));
        }
        if ((match = path.match(/^\/api\/workspace\/resources\/([^/]+)\/approve$/)) && req.method === 'POST') { await body(req); store.approveResource(user, match[1]); return json(res, 200, { ok: true }); }
        if ((match = path.match(/^\/api\/workspace\/submissions\/([^/]+)\/review$/)) && req.method === 'POST') { store.reviewSubmission(user, match[1], await body(req)); return json(res, 200, { ok: true }); }
        if ((match = path.match(/^\/api\/workspace\/tasks\/([^/]+)\/(plan|delay|resources|requirements|submit)$/)) && req.method === 'POST') {
          const input = await body(req);
          const methods = { plan: 'configureWork', delay: 'delayWork', resources: 'addResource', requirements: 'requirement', submit: 'submitWork' };
          return json(res, 200, store[methods[match[2]]](user, match[1], input) || { ok: true });
        }
        if ((match = path.match(/^\/api\/workspace\/users\/([^/]+)\/disable$/)) && req.method === 'POST') {
          await body(req); store.disableUser(user, decodeURIComponent(match[1]));
          return json(res, 200, { ok: true });
        }
        if ((match = path.match(/^\/api\/workspace\/projects\/([^/]+)\/(activate|members|tasks|requests)$/)) && req.method === 'POST') {
          const input = await body(req); const projectId = match[1];
          if (match[2] === 'activate') return json(res, 200, store.activate(user, projectId, input));
          if (match[2] === 'members') {
            if (typeof input.add !== 'boolean') throw new WorkspaceError('Membership action must specify add.');
            store.setMember(user, projectId, input.userId, input.add);
            return json(res, 200, { ok: true });
          }
          if (match[2] === 'tasks') return json(res, 201, store.createTask(user, projectId, input));
          return json(res, 201, store.manualRequest(user, projectId, input));
        }
        if ((match = path.match(/^\/api\/workspace\/requests\/([^/]+)\/review$/)) && req.method === 'POST') return json(res, 200, store.reviewRequest(user, match[1], await body(req)));
        if ((match = path.match(/^\/api\/workspace\/notifications\/([^/]+)\/read$/)) && req.method === 'POST') {
          await body(req); store.readNotification(user, match[1]);
          return json(res, 200, { ok: true });
        }
        if ((match = path.match(/^\/api\/workspace\/tasks\/([^/]+)(?:\/(messages|read))?$/))) {
          const taskId = match[1];
          if (!match[2] && req.method === 'GET') return json(res, 200, store.thread(user, taskId));
          if (!match[2] && req.method === 'PATCH') { store.updateTask(user, taskId, await body(req)); return json(res, 200, { ok: true }); }
          if (match[2] === 'messages' && req.method === 'POST') return json(res, 201, store.postMessage(user, taskId, await body(req)));
          if (match[2] === 'read' && req.method === 'POST') { store.readThread(user, taskId, (await body(req)).lastSeq); return json(res, 200, { ok: true }); }
        }
        return json(res, 404, { error: 'API route not found.' });
      }
      if (req.method !== 'GET') return json(res, 404, { error: 'Not found.' });
      const root = resolve(staticDirectory);
      const filename = resolve(root, `.${decodeURIComponent(path)}`);
      if (filename !== root && !filename.startsWith(root + sep)) throw new WorkspaceError('Not found.', 404);
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
      let data; let type;
      try { data = await readFile(filename); type = types[extname(filename)] || 'application/octet-stream'; }
      catch {
        if (extname(path)) throw new WorkspaceError('File not found.', 404);
        try { data = await readFile(resolve(root, 'index.html')); type = 'text/html'; }
        catch { throw new WorkspaceError('Build the frontend with npm run frontend:build, or open the Vite development server.', 404); }
      }
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' });
      res.end(data);
    } catch (error) {
      const status = error instanceof WorkspaceError || [400, 403, 404, 409, 422].includes(error.status) ? error.status : 500;
      if (status === 500) console.error('Workspace request failed:', error.message);
      json(res, status, { error: status === 500 ? 'Could not complete this request.' : error.message });
    }
  });
  let delivering = false;
  const outbox = groupToken ? setInterval(async () => {
    if (delivering) return; delivering = true;
    try { for (const reply of store.all("SELECT id FROM replies WHERE state='Queued' ORDER BY createdAt LIMIT 10")) await deliverReply(store, reply.id, groupToken); }
    catch (error) { console.warn('Reply delivery needs checking:', error.message); }
    finally { delivering = false; }
  }, 5000) : null;
  if (outbox) { outbox.unref(); server.on('close', () => clearInterval(outbox)); }
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.NODE_ENV === 'production') {
    if (!/^https:\/\//.test(process.env.WORKSPACE_ORIGIN || '') || process.env.WORKSPACE_SECURE_COOKIES !== 'true' || !process.env.WORKSPACE_DB_PATH) {
      console.error('Production requires an HTTPS WORKSPACE_ORIGIN, secure cookies, and a persistent WORKSPACE_DB_PATH.');
      process.exit(1);
    }
  }
  const store = new WorkspaceStore(process.env.WORKSPACE_DB_PATH || 'data/workspace.sqlite');
  try { store.bootstrap(process.env.WORKSPACE_FOUNDER_ID, process.env.WORKSPACE_FOUNDER_PASSWORD, process.env.WORKSPACE_FOUNDER_NAME || 'Studio founder'); }
  catch (error) { console.error(error.message); store.close(); process.exit(1); }
  const server = createWorkspaceServer({
    store, origin: process.env.WORKSPACE_ORIGIN || '', secureCookies: process.env.WORKSPACE_SECURE_COOKIES === 'true',
    integrationSecret: process.env.INTEGRATION_SHARED_SECRET || '',
    groupToken: process.env.GROUP_BOT_TOKEN || '',
  });
  const port = Number(process.env.PORT || process.env.WORKSPACE_PORT || 3002);
  const host = process.env.WORKSPACE_HOST || '127.0.0.1';
  server.listen(port, host, () => console.log(`Internal workspace listening at http://${host}:${port}`));
  const shutdown = () => server.close(() => { store.close(); process.exit(0); });
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
}
