import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkspaceStore, WorkspaceError } from './store.js';

const json = (res, status, data) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
};
const equal = (left, right) => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};
const tokenFrom = (req) =>
  req.headers.cookie
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('iksha_session='))
    ?.slice('iksha_session='.length) || '';
const body = async (req) => {
  if (!req.headers['content-type']?.startsWith('application/json'))
    throw new WorkspaceError('Send application/json.', 415);
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > 65000) throw new WorkspaceError('Request is too large.', 413);
  }
  try {
    const value = JSON.parse(raw || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new WorkspaceError('Invalid JSON request.');
  }
};

export function createWorkspaceServer({
  store,
  origin = '',
  secureCookies = false,
  integrationSecret = '',
  staticDirectory = resolve('frontend/dist'),
}) {
  const attempts = new Map();
  const cookie = (token, expire = false) =>
    `iksha_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${expire ? 0 : 43200}${secureCookies ? '; Secure' : ''}`;
  const server = http.createServer(async (req, res) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('x-frame-options', 'DENY');
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && path === '/health') return json(res, 200, { ok: true });
      if (path === '/api/integrations/telegram/requests' && req.method === 'POST') {
        if (
          !integrationSecret ||
          !equal((req.headers.authorization || '').replace(/^Bearer /i, ''), integrationSecret)
        )
          throw new WorkspaceError('Integration authentication required.', 401);
        return json(res, 200, store.telegramRequest(await body(req)));
      }
      if (path.startsWith('/api/')) {
        // Browser mutations require JSON and a matching origin. Integration uses its own bearer secret.
        if (
          !['GET', 'HEAD'].includes(req.method) &&
          req.headers.origin &&
          req.headers.origin !== (origin || `http://${req.headers.host}`)
        )
          throw new WorkspaceError('Origin is not allowed.', 403);
        if (path === '/api/workspace/login' && req.method === 'POST') {
          const address = req.socket.remoteAddress || 'unknown';
          const time = Date.now();
          for (const [key, value] of attempts) if (value.expiresAt < time) attempts.delete(key);
          const attempt = attempts.get(address) || { count: 0, expiresAt: time + 900000 };
          if (attempt.count >= 15)
            throw new WorkspaceError('Too many sign-in attempts. Try again in 15 minutes.', 429);
          attempt.count += 1;
          attempts.set(address, attempt);
          const input = await body(req);
          const login = store.login(input.id, input.password);
          attempts.delete(address);
          res.setHeader('set-cookie', cookie(login.token));
          return json(res, 200, { user: login.user });
        }
        const token = tokenFrom(req);
        const user = store.authenticate(token);
        if (path === '/api/workspace/logout' && req.method === 'POST') {
          await body(req);
          store.logout(token);
          res.setHeader('set-cookie', cookie('', true));
          return json(res, 200, { ok: true });
        }
        if (path === '/api/workspace' && req.method === 'GET')
          return json(res, 200, store.snapshot(user));
        if (path === '/api/workspace/users' && req.method === 'POST')
          return json(res, 201, store.createUser(user, await body(req)));
        if (path === '/api/workspace/clients' && req.method === 'POST')
          return json(res, 201, store.createClient(user, await body(req)));
        if (path === '/api/workspace/projects' && req.method === 'POST')
          return json(res, 201, store.createProject(user, await body(req)));
        let match;
        if (
          (match = path.match(/^\/api\/workspace\/users\/([^/]+)\/disable$/)) &&
          req.method === 'POST'
        ) {
          await body(req);
          store.disableUser(user, decodeURIComponent(match[1]));
          return json(res, 200, { ok: true });
        }
        if (
          (match = path.match(
            /^\/api\/workspace\/projects\/([^/]+)\/(activate|members|tasks|requests)$/,
          )) &&
          req.method === 'POST'
        ) {
          const input = await body(req);
          const projectId = match[1];
          if (match[2] === 'activate')
            return json(res, 200, store.activate(user, projectId, input));
          if (match[2] === 'members') {
            if (typeof input.add !== 'boolean')
              throw new WorkspaceError('Membership action must specify add.');
            store.setMember(user, projectId, input.userId, input.add);
            return json(res, 200, { ok: true });
          }
          if (match[2] === 'tasks') return json(res, 201, store.createTask(user, projectId, input));
          return json(res, 201, store.manualRequest(user, projectId, input));
        }
        if (
          (match = path.match(/^\/api\/workspace\/requests\/([^/]+)\/review$/)) &&
          req.method === 'POST'
        )
          return json(res, 200, store.reviewRequest(user, match[1], await body(req)));
        if (
          (match = path.match(/^\/api\/workspace\/notifications\/([^/]+)\/read$/)) &&
          req.method === 'POST'
        ) {
          await body(req);
          store.readNotification(user, match[1]);
          return json(res, 200, { ok: true });
        }
        if ((match = path.match(/^\/api\/workspace\/tasks\/([^/]+)(?:\/(messages|read))?$/))) {
          const taskId = match[1];
          if (!match[2] && req.method === 'GET') return json(res, 200, store.thread(user, taskId));
          if (!match[2] && req.method === 'PATCH') {
            store.updateTask(user, taskId, await body(req));
            return json(res, 200, { ok: true });
          }
          if (match[2] === 'messages' && req.method === 'POST')
            return json(res, 201, store.postMessage(user, taskId, await body(req)));
          if (match[2] === 'read' && req.method === 'POST') {
            store.readThread(user, taskId, (await body(req)).lastSeq);
            return json(res, 200, { ok: true });
          }
        }
        return json(res, 404, { error: 'API route not found.' });
      }
      if (req.method !== 'GET') return json(res, 404, { error: 'Not found.' });
      const root = resolve(staticDirectory);
      const filename = resolve(root, `.${decodeURIComponent(path)}`);
      if (filename !== root && !filename.startsWith(root + sep))
        throw new WorkspaceError('Not found.', 404);
      const types = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.woff2': 'font/woff2',
      };
      let data;
      let type;
      try {
        data = await readFile(filename);
        type = types[extname(filename)] || 'application/octet-stream';
      } catch {
        if (extname(path)) throw new WorkspaceError('File not found.', 404);
        try {
          data = await readFile(resolve(root, 'index.html'));
          type = 'text/html';
        } catch {
          throw new WorkspaceError(
            'Build the frontend with npm run frontend:build, or open the Vite development server.',
            404,
          );
        }
      }
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' });
      res.end(data);
    } catch (error) {
      const status = error instanceof WorkspaceError ? error.status : 500;
      if (status === 500) console.error('Workspace request failed:', error.message);
      json(res, status, {
        error: status === 500 ? 'Could not complete this request.' : error.message,
      });
    }
  });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const store = new WorkspaceStore(process.env.WORKSPACE_DB_PATH || 'data/workspace.sqlite');
  try {
    store.bootstrap(
      process.env.WORKSPACE_FOUNDER_ID,
      process.env.WORKSPACE_FOUNDER_PASSWORD,
      process.env.WORKSPACE_FOUNDER_NAME || 'Studio founder',
    );
  } catch (error) {
    console.error(error.message);
    store.close();
    process.exit(1);
  }
  const server = createWorkspaceServer({
    store,
    origin: process.env.WORKSPACE_ORIGIN || '',
    secureCookies: process.env.WORKSPACE_SECURE_COOKIES === 'true',
    integrationSecret: process.env.INTEGRATION_SHARED_SECRET || '',
  });
  const port = Number(process.env.WORKSPACE_PORT || 3002);
  const host = process.env.WORKSPACE_HOST || '127.0.0.1';
  server.listen(port, host, () =>
    console.log(`Internal workspace listening at http://${host}:${port}`),
  );
  const shutdown = () =>
    server.close(() => {
      store.close();
      process.exit(0);
    });
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
