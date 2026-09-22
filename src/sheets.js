import crypto from 'node:crypto';
import { googleConfig } from './config.js';
import { SHEETS } from './schema.js';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

const base64Url = (value) => Buffer.from(value).toString('base64url');
const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

export class SheetStore {
  constructor() {
    this.config = googleConfig();
    this.token = null;
    this.tokenExpiry = 0;
  }

  async accessToken() {
    if (this.token && Date.now() < this.tokenExpiry) return this.token;
    const issuedAt = Math.floor(Date.now() / 1000);
    const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claim = base64Url(JSON.stringify({
      iss: this.config.serviceAccountEmail,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: GOOGLE_TOKEN_URL,
      iat: issuedAt,
      exp: issuedAt + 3600,
    }));
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(`${header}.${claim}`);
    const signature = signer.sign(this.config.privateKey, 'base64url');
    const assertion = `${header}.${claim}.${signature}`;
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion,
      }),
    });
    if (!response.ok) throw new Error(`Google authentication failed: ${await response.text()}`);
    const body = await response.json();
    this.token = body.access_token;
    this.tokenExpiry = Date.now() + (body.expires_in - 60) * 1000;
    return this.token;
  }

  async request(path, options = {}) {
    const token = await this.accessToken();
    const response = await fetch(`${SHEETS_API}/${this.config.sheetId}${path}`, {
      ...options,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...(options.headers ?? {}),
      },
    });
    if (!response.ok) throw new Error(`Google Sheets request failed: ${await response.text()}`);
    return response.status === 204 ? null : response.json();
  }

  async getSpreadsheet() { return this.request('?fields=sheets.properties'); }

  async ensureSchema() {
    const spreadsheet = await this.getSpreadsheet();
    const existing = new Set(spreadsheet.sheets.map((sheet) => sheet.properties.title));
    const missing = Object.keys(SHEETS).filter((name) => !existing.has(name));
    if (missing.length) {
      await this.request(':batchUpdate', {
        method: 'POST', body: JSON.stringify({ requests: missing.map((title) => ({ addSheet: { properties: { title } } })) }),
      });
    }
    for (const [name, headers] of Object.entries(SHEETS)) {
      await this.request(`/values/${encodeURIComponent(`${name}!A1`)}?valueInputOption=RAW`, {
        method: 'PUT', body: JSON.stringify({ values: [headers] }),
      });
    }
  }

  async rows(sheetName) {
    const response = await this.request(`/values/${encodeURIComponent(`${sheetName}!A:Z`)}`);
    const values = response.values ?? [];
    const [headers = [], ...data] = values;
    return data.filter((row) => row.some(Boolean)).map((row, index) => ({
      rowNumber: index + 2,
      ...Object.fromEntries(headers.map((header, column) => [header, row[column] ?? ''])),
    }));
  }

  async append(sheetName, object) {
    const headers = SHEETS[sheetName];
    const values = headers.map((header) => object[header] ?? '');
    await this.request(`/values/${encodeURIComponent(`${sheetName}!A:Z`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
      method: 'POST', body: JSON.stringify({ values: [values] }),
    });
  }

  async updateRow(sheetName, rowNumber, changes) {
    const headers = SHEETS[sheetName];
    const requests = Object.entries(changes).map(([field, value]) => {
      const column = headers.indexOf(field);
      if (column < 0) throw new Error(`Unknown ${sheetName} field: ${field}`);
      const letter = String.fromCharCode(65 + column);
      return { range: `${sheetName}!${letter}${rowNumber}`, values: [[value]] };
    });
    await this.request('/values:batchUpdate', {
      method: 'POST', body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: requests }),
    });
  }

  async audit({ projectId, taskId = '', action, oldValue = '', newValue = '', actor, actorName, source, details = '' }) {
    await this.append('AuditLog', {
      AuditID: id('AUD'), OccurredAt: now(), ProjectID: projectId, TaskID: taskId,
      Action: action, OldValue: oldValue, NewValue: newValue,
      ActorTelegramID: String(actor), ActorName: actorName, Source: source, Details: details,
    });
  }

  async projectForGroup(groupChatId) {
    return (await this.rows('Projects')).find((project) => String(project.GroupChatID) === String(groupChatId));
  }

  async projectById(projectId) {
    return (await this.rows('Projects')).find((project) => project.ProjectID === projectId);
  }

  async registerGroup(groupChatId, groupTitle) {
    const groups = await this.rows('GroupRegistry');
    const existing = groups.find((group) => String(group.GroupChatID) === String(groupChatId));
    if (existing) {
      await this.updateRow('GroupRegistry', existing.rowNumber, { GroupTitle: groupTitle, Status: 'Available' });
      return;
    }
    await this.append('GroupRegistry', { GroupChatID: String(groupChatId), GroupTitle: groupTitle, RegisteredAt: now(), Status: 'Available' });
  }

  async availableGroups() {
    const mappedGroups = new Set((await this.rows('Projects')).map((project) => String(project.GroupChatID)));
    return (await this.rows('GroupRegistry')).filter((group) => group.Status === 'Available' && !mappedGroups.has(String(group.GroupChatID)));
  }

  async markGroupLinked(groupChatId) {
    const group = (await this.rows('GroupRegistry')).find((item) => String(item.GroupChatID) === String(groupChatId));
    if (group) await this.updateRow('GroupRegistry', group.rowNumber, { Status: 'Linked' });
  }

  async task(taskId) { return (await this.rows('Tasks')).find((task) => task.TaskID === taskId); }
  async tasksForProject(projectId) { return (await this.rows('Tasks')).filter((task) => task.ProjectID === projectId); }
  async approvals(status = 'Pending') { return (await this.rows('Approvals')).filter((item) => item.Status === status); }
  async user(telegramId) { return (await this.rows('Users')).find((user) => String(user.TelegramUserID) === String(telegramId) && user.Active === 'Yes'); }
  async activeUsers() { return (await this.rows('Users')).filter((user) => user.Active === 'Yes'); }
  async onboarding(onboardingId) { return (await this.rows('MemberOnboarding')).find((item) => item.OnboardingID === onboardingId); }
  async onboardingForMember(projectId, telegramId) {
    return (await this.rows('MemberOnboarding')).find((item) => item.ProjectID === projectId && String(item.TelegramUserID) === String(telegramId) && ['Pending', 'Approved'].includes(item.Status));
  }
  async createOnboarding({ onboardingId, projectId, groupChatId, telegramId, telegramName }) {
    await this.append('MemberOnboarding', { OnboardingID: onboardingId, ProjectID: projectId, GroupChatID: String(groupChatId), TelegramUserID: String(telegramId), TelegramName: telegramName, JoinedAt: now(), Status: 'Pending' });
  }
  async approveOnboarding(onboarding, { name, role, founderTelegramId }) {
    const existing = await this.user(onboarding.TelegramUserID);
    if (existing) await this.updateRow('Users', existing.rowNumber, { Name: name, Role: role, Active: 'Yes' });
    else await this.append('Users', { TelegramUserID: onboarding.TelegramUserID, Name: name, Role: role, Active: 'Yes' });
    await this.updateRow('MemberOnboarding', onboarding.rowNumber, { Status: 'Approved', AssignedName: name, AssignedRole: role, ApprovedAt: now(), ApprovedByTelegramID: String(founderTelegramId) });
  }

  async requestDelay({ project, task, actor, days, reason }) {
    const approvalId = id('APR');
    await this.append('Approvals', {
      ApprovalID: approvalId, ProjectID: project.ProjectID, TaskID: task.TaskID,
      RequestType: 'Delay', RequestedByTelegramID: String(actor.id), RequestedByName: actor.name,
      Reason: reason, DelayDays: String(days), Status: 'Pending', GroupChatID: String(project.GroupChatID), CreatedAt: now(),
    });
    await this.updateRow('Tasks', task.rowNumber, {
      Status: 'Delay Requested', DelayDays: String(days), DelayReason: reason,
      ApprovalStatus: 'Pending', LastUpdatedAt: now(), LastUpdatedBy: String(actor.id),
    });
    await this.audit({ projectId: project.ProjectID, taskId: task.TaskID, action: 'Delay requested', oldValue: task.Status, newValue: 'Delay Requested', actor: actor.id, actorName: actor.name, source: 'Telegram group bot', details: `${days} day(s): ${reason}` });
    return approvalId;
  }
}
