// Local web bridge with an in-memory sheet, so the web app can be driven without Google or Telegram credentials.
// Run: INTEGRATION_SHARED_SECRET=dev-secret BOT_BRIDGE_PORT=3001 node src/dev-bridge.js
// Nothing here is persisted; restarting clears every stage and task.
import { startWebBridge } from './web-bridge.js';

if (!process.env.INTEGRATION_SHARED_SECRET) process.env.INTEGRATION_SHARED_SECRET = 'dev-secret';
if (!process.env.BOT_BRIDGE_PORT) process.env.BOT_BRIDGE_PORT = '3001';

const sheets = {
  Projects: [{ ProjectID: 'P900', ProjectName: 'Demo Residence', ClientName: 'Demo Client', GroupChatID: '-900', Status: 'Active', StartDate: '2026-10-16', WebManaged: 'Yes', WorkflowAnnouncementStatus: 'Sent', ClientTelegramID: '500', rowNumber: 2 }],
  GroupMembers: [
    { GroupChatID: '-900', TelegramUserID: '500', TelegramName: 'Client', MembershipStatus: 'Active', AssignedName: 'Demo Client', AssignedRole: 'Client' },
    { GroupChatID: '-900', TelegramUserID: '501', TelegramName: 'Designer', MembershipStatus: 'Active', AssignedName: 'Demo Designer', AssignedRole: 'Designer' },
  ],
  Tasks: [],
  WorkflowTemplates: [],
  DecisionRequests: [{ RequestID: 'REQ--900-10-question', ProjectID: 'P900', GroupChatID: '-900', SourceMessageID: '10', AttachmentsJSON: '[]', Status: 'Pending', rowNumber: 2 }],
  AuditLog: [],
};
const rowsOf = (sheet) => (sheets[sheet] ||= []);
const store = {
  rows: async (sheet) => rowsOf(sheet),
  tasksForProject: async (projectId) => sheets.Tasks.filter((task) => task.ProjectID === projectId).map((task) => ({ ...task })),
  projectForGroup: async (groupChatId) => sheets.Projects.find((project) => String(project.GroupChatID) === String(groupChatId)),
  append: async (sheet, row) => { rowsOf(sheet).push({ ...row, rowNumber: rowsOf(sheet).length + 2 }); },
  appendRows: async (sheet, rows) => { for (const row of rows) rowsOf(sheet).push({ ...row, rowNumber: rowsOf(sheet).length + 2 }); },
  updateRow: async (sheet, rowNumber, changes) => Object.assign(rowsOf(sheet).find((row) => row.rowNumber === rowNumber), changes),
  updateRows: async (sheet, list) => { for (const { rowNumber, changes } of list) Object.assign(rowsOf(sheet).find((row) => row.rowNumber === rowNumber), changes); },
  audit: async (entry) => { rowsOf('AuditLog').push(entry); console.log(`[audit] ${entry.action}: ${entry.newValue || ''}`); },
  groupSnapshot: async () => [],
};

// Telegram calls (announcements, published replies) are logged instead of sent.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (String(url).startsWith('https://api.telegram.org/')) {
    console.log(`[telegram] ${String(url).split('/').at(-1)} ${options?.body || ''}`);
    return Response.json({ ok: true, result: { message_id: Math.floor(Math.random() * 100000) + 1 } });
  }
  return realFetch(url, options);
};

startWebBridge({ store, token: 'dev-token', founderTelegramId: '1' });
