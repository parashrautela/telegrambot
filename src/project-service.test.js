import test from 'node:test';
import assert from 'node:assert/strict';
import { assignWorkflowToProject, createProjectShell } from './project-service.js';

function fixture() {
  const project = { ProjectID: 'P001', GroupChatID: '-123', ClientName: 'Maya', StartDate: '2026-10-02', rowNumber: 2 };
  const data = { Projects: [], Tasks: [], GroupMembers: [], MemberOnboarding: [], WorkflowTemplates: [{ WorkflowID: 'TEST', Sequence: '10', Stage: 'Design', TaskName: 'Review brief', DurationDays: '1', DefaultRole: 'Designer' }] };
  const updates = [];
  const store = { rows: async (name) => data[name] || [], tasksForProject: async () => data.Tasks, append: async (name, row) => data[name].push(row), updateRow: async (name, rowNumber, value) => updates.push({ name, value }), audit: async () => {}, markGroupLinked: async () => {} };
  return { project, data, updates, store };
}
test('a client name alone cannot activate a bot workflow', async () => {
  const { store, project, data } = fixture();
  await assert.rejects(assignWorkflowToProject({ store, project, workflowId: 'TEST' }), /active, approved client/);
  assert.equal(data.Tasks.length, 0);
});
test('approved client identity is retained during task generation', async () => {
  const { store, project, data, updates } = fixture();
  data.GroupMembers.push({ GroupChatID: '-123', TelegramUserID: '42', AssignedName: 'Maya', AssignedRole: 'Client', MembershipStatus: 'Active' });
  await assignWorkflowToProject({ store, project, workflowId: 'TEST' });
  assert.equal(data.Tasks.length, 1);
  assert.equal(updates.at(-1).value.ClientTelegramID, '42');
});
test('left clients cannot activate a workflow through historic onboarding', async () => {
  const { store, project, data } = fixture();
  data.GroupMembers.push({ GroupChatID: '-123', TelegramUserID: '42', AssignedRole: 'Client', MembershipStatus: 'Left' });
  data.MemberOnboarding.push({ ProjectID: 'P001', TelegramUserID: '42', AssignedName: 'Maya', AssignedRole: 'Client', Status: 'Approved' });
  await assert.rejects(assignWorkflowToProject({ store, project, workflowId: 'TEST' }), /active, approved client/);
});
test('a previously bound client cannot be silently replaced by another client', async () => {
  const { store, project, data } = fixture();
  project.ClientTelegramID = '42';
  data.GroupMembers.push({ GroupChatID: '-123', TelegramUserID: '43', AssignedName: 'Other', AssignedRole: 'Client', MembershipStatus: 'Active' });
  await assert.rejects(assignWorkflowToProject({ store, project, workflowId: 'TEST' }), /active, approved client/);
});
test('project shells also require client information', async () => {
  const { store } = fixture();
  await assert.rejects(createProjectShell({ store, projectId: 'P001', projectName: 'House', startDateText: '2026-10-02', groupChatId: '-123' }), /Assign a client/);
});
