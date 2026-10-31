// An isolated local preview. Never reads .env or starts Telegram polling.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { WorkspaceStore } from '../src/workspace/store.js';
import { createWorkspaceServer } from '../src/workspace/server.js';

const directory = mkdtempSync(join(tmpdir(), 'iksha-preview-'));
const store = new WorkspaceStore(join(directory, 'workspace.sqlite'));
const password = randomBytes(12).toString('hex');
store.bootstrap('founder', password, 'Ishita Kapoor');
const founder = store.login('founder', password).user;
store.createUser(founder, { id: 'neha', name: 'Neha Shah', role: 'Designer', password });
store.createUser(founder, { id: 'aarav', name: 'Aarav Mehta', role: 'Project lead', password });
const designer = store.login('neha', password).user;
const client = store.createClient(founder, { name: 'Maya Sharma' });
const project = store.createProject(founder, {
  name: 'Parash ka Ghar',
  location: 'Bandra, Mumbai',
  clientId: client.id,
});
store.setMember(founder, project.id, 'neha', true);
store.setMember(founder, project.id, 'aarav', true);
store.activate(founder, project.id, { workflowId: 'PAINTING-V1', ownerId: 'neha' });
const request = store.manualRequest(founder, project.id, {
  sender: 'Maya Sharma',
  type: 'Question',
  body: 'The living room wall feels darker than expected. Can we check the paint shade before the second coat?',
});
const { taskId } = store.reviewRequest(founder, request.id, {
  status: 'Approved',
  ownerId: 'neha',
  title: 'Living room paint shade',
});
store.postMessage(founder, taskId, {
  body: 'Let’s compare the first coat in natural light before proceeding. Neha, please coordinate the sample check with the site team.',
});
store.postMessage(designer, taskId, {
  body: 'I’ve spoken with the supervisor. We’ll check it at the site tomorrow morning and share our recommendation here.',
});
store.updateTask(designer, taskId, {
  status: 'In progress',
  decision: 'Compare the dried first coat before approving the shade.',
  nextAction: 'Neha to review the sample with the site team tomorrow.',
});
store.manualRequest(founder, project.id, {
  sender: 'Maya Sharma',
  type: 'Approval',
  body: 'Could we move the dining pendant toward the center of the table?',
});
const otherClient = store.createClient(founder, { name: 'Dev Nishank' });
store.createProject(founder, {
  name: 'Nishank House',
  location: 'Pune, Maharashtra',
  clientId: otherClient.id,
});
// Disposable schedule examples for the integrated timeline, never production records.
const previewClient = store.createClient(founder, { name: 'Sample client' });
const previewProject = store.createProject(founder, {
  name: 'The Courtyard Residence · Demo',
  location: 'Residential interior',
  clientId: previewClient.id,
});
store.setMember(founder, previewProject.id, 'neha', true);
store.setMember(founder, previewProject.id, 'aarav', true);
store.run("UPDATE projects SET status='Active' WHERE id=?", previewProject.id);
const base = new Date();
base.setHours(9, 0, 0, 0);
const sampleWork = [
  ['Design plan', 'Collect client resources', 0, 4, 'Resolved', 'aarav'],
  ['Design plan', '2D drawing', 4, 27, 'In progress', 'neha'],
  ['Design plan', 'Design head review', 27, 30, 'Open', 'founder'],
  ['Design plan', 'Client presentation & feedback', 30, 34, 'Open', 'aarav'],
  ['Design concept', '3D concept from the approved layout', 48, 72, 'Open', 'neha'],
  ['3D design', 'Detailed views & material direction', 72, 99, 'Open', 'neha'],
  ['Civil work', 'Site readiness & drawings', 96, 104, 'Open', 'aarav'],
  ['Civil work', 'Civil execution & inspection', 104, 152, 'Open', 'aarav'],
  ['Electrical work', 'Electrical drawings & routing', 104, 128, 'Open', 'neha'],
  ['Electrical work', 'Electrical work & final check', 128, 158, 'Open', 'aarav'],
];
for (const [stage, title, startHour, endHour, status, owner] of sampleWork) {
  const taskId = store.insertTask(previewProject.id, title, 'Task', owner, stage);
  store.updateTask(founder, taskId, {
    status,
    nextAction: 'Review the output with the next owner and record the handoff in this discussion.',
    scheduledStart: new Date(base.getTime() + startHour * 3600000).toISOString(),
    scheduledEnd: new Date(base.getTime() + endHour * 3600000).toISOString(),
  });
}
store.manualRequest(founder, previewProject.id, {
  sender: 'Sample client',
  type: 'Approval',
  body: 'Please review the revised living room layout before we begin the 3D concept.',
});
const server = createWorkspaceServer({ store });
server.listen(3002, '127.0.0.1', () => {
  console.log('Isolated preview: http://127.0.0.1:3002');
  console.log(`Preview staff IDs: founder, neha, aarav. Temporary password: ${password}`);
  console.log(`Open discussion: http://127.0.0.1:3002/?project=${project.id}&thread=${taskId}`);
  console.log(`Open timeline: http://127.0.0.1:3002/?project=${previewProject.id}`);
  console.log('This preview uses disposable sample data. No production services are connected.');
});
const shutdown = () =>
  server.close(() => {
    store.close();
    process.exit(0);
  });
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
