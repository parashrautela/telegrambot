// An isolated local preview. Never reads .env or starts Telegram polling.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { WorkspaceStore } from './workspace-store.js';
import { createWorkspaceServer } from './workspace-server.js';

const directory = mkdtempSync(join(tmpdir(), 'iksha-preview-'));
const store = new WorkspaceStore(join(directory, 'workspace.sqlite'));
const password = randomBytes(12).toString('hex');
store.bootstrap('founder', password, 'Studio founders');
const founder = store.login('founder', password).user;
store.createUser(founder, { id: 'neha', name: 'Neha Shah', role: 'Designer', password });
store.createUser(founder, { id: 'aarav', name: 'Aarav Mehta', role: 'Project lead', password });
const designer = store.login('neha', password).user;
const client = store.createClient(founder, { name: 'Maya Sharma' });
const project = store.createProject(founder, { name: 'Parash ka Ghar', location: 'Bandra, Mumbai', clientId: client.id });
store.setMember(founder, project.id, 'neha', true);
store.setMember(founder, project.id, 'aarav', true);
store.activate(founder, project.id, { workflowId: 'PAINTING-V1', ownerId: 'neha' });
const request = store.manualRequest(founder, project.id, { sender: 'Maya Sharma', type: 'Question', body: 'The living room wall feels darker than expected. Can we check the paint shade before the second coat?' });
const { taskId } = store.reviewRequest(founder, request.id, { status: 'Approved', ownerId: 'neha', title: 'Living room paint shade' });
store.postMessage(founder, taskId, { body: 'Let’s compare the first coat in natural light before proceeding. Neha, please coordinate the sample check with the site team.' });
store.postMessage(designer, taskId, { body: 'I’ve spoken with the supervisor. We’ll check it at the site tomorrow morning and share our recommendation here.' });
store.updateTask(designer, taskId, { status: 'In progress', decision: 'Compare the dried first coat before approving the shade.', nextAction: 'Neha to review the sample with the site team tomorrow.' });
store.manualRequest(founder, project.id, { sender: 'Maya Sharma', type: 'Approval', body: 'Could we move the dining pendant toward the center of the table?' });

// Sample carpentry work demonstrates the new intervention and Backtrack journey.
const carpentry = store.createTask(founder, project.id, { title: 'Living room storage carpentry', kind: 'Task', ownerId: 'aarav' });
store.configureWork(founder, carpentry.id, { version: 1, brief: 'Build the storage unit from the approved drawing. Use light oak and recessed handles. Check the finish before installation.', externalName: 'Ravi · Carpenter', externalTelegramId: '901', durationDays: 4, notBefore: '2026-10-12' });
store.run('UPDATE projects SET telegramProjectId=?,groupChatId=? WHERE id=?', 'DEMO-HOUSE', '-100000001', project.id);
const question = store.manualRequest(founder, project.id, { sender: 'Ravi · Carpenter', type: 'Question', body: 'The oak sample is a little darker than the drawing. Should I use this finish or wait for the lighter sample?' });
const intervention = store.snapshot(founder).interventions.find(i => i.requestId === question.id);
store.handleIntervention(founder, intervention.id, { action: 'link', taskId: carpentry.id, version: intervention.version });
store.postMessage(founder, carpentry.id, { body: 'Please compare the finish in daylight before installation. Share a sample photo if anything differs from the approved drawing.' });
store.postMessage(designer, carpentry.id, { body: 'The intended finish is a light natural oak. The darker sample needs founder confirmation.' });
const reviewWork = store.createTask(founder, project.id, { title: 'Kitchen cabinet installation', kind: 'Task', ownerId: 'neha' });
store.submitWork(designer, reviewWork.id, { evidenceUrl: 'https://example.com/demo-kitchen-photo.jpg', note: 'Sample review: installation photos are ready for the founders. This preview link is illustrative.' });

const otherClient = store.createClient(founder, { name: 'Dev Nishank' });
store.createProject(founder, { name: 'Nishank House', location: 'Pune, Maharashtra', clientId: otherClient.id });
const server = createWorkspaceServer({ store });
server.listen(3002, '127.0.0.1', () => {
  console.log('Isolated preview: http://127.0.0.1:3002');
  console.log(`Preview staff IDs: founder, neha, aarav. Temporary password: ${password}`);
  console.log(`Open discussion: http://127.0.0.1:3002/?project=${project.id}&thread=${taskId}`);
  console.log('This preview uses disposable sample data. No production services are connected.');
});
const shutdown = () => server.close(() => { store.close(); process.exit(0); });
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
