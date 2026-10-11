export type Staff = { id: string; name: string; role: string; active: boolean }
export type Project = { id: string; name: string; clientName: string; clientId: string; location: string; status: string; workflowId: string; unread: number; telegramProjectId: string | null; groupChatId: string | null }
export type Task = { id: string; projectId: string; title: string; kind: string; stage: string; ownerId: string | null; ownerName?: string; status: string; decision: string; blocker: string; nextAction: string; unread: number; lastActivity: string; createdAt: string; brief: string; externalName: string; externalTelegramId: string; durationDays: number | null; delayDays: number; baselineStart: string; baselineEnd: string; forecastStart: string; forecastEnd: string; actualStart: string; actualEnd: string; notBefore: string; unscheduledReason: string; dependencyBlocker: string; version: number }
export type Intervention = { id: string; projectId: string; taskId: string | null; requestId: string | null; kind: string; title: string; body: string; sender: string; status: string; owner: string; readAt: string | null; version: number; createdAt: string }
export type Resource = { id: string; taskId: string; title: string; url: string; purpose: string; state: string; createdAt: string }
export type Submission = { id: string; taskId: string; evidenceUrl: string; note: string; status: string; feedback: string; createdAt: string }
export type ProjectEvent = { seq: number; projectId: string; taskId: string | null; kind: string; body: string; actor: string; createdAt: string }
export type Reply = { id: string; body: string; state: string; error: string }
export type Backtrack = { item: Intervention; task: Task | null; request: ClientRequest | null; messages: Thread['messages']; conversation: { id: string; authorName: string; body: string; createdAt: string; visibility: string }[]; resources: Resource[]; history: ProjectEvent[]; replies: Reply[] }
export type Attachment = { type: string; url?: string; fileId?: string; fileName?: string }
export type ClientRequest = { id: string; projectId: string; type: string; body: string; context: string; sender: string; source: string; status: string; taskId: string | null; reviewNote: string; createdAt: string; attachments: Attachment[] }
export type Notification = { id: string; projectId: string; taskId: string | null; kind: string; body: string; createdAt: string; readAt: string | null }
export type Snapshot = {
  user: Staff; users: Staff[]; projects: Project[]; tasks: Task[]; requests: ClientRequest[];
  memberships: { projectId: string; userId: string }[];
  clients: { id: string; name: string; telegramId: string }[];
  workflows: { id: string; label: string; description: string; taskCount: number }[];
  notifications: Notification[];
  notificationUnread: number;
  interventions: Intervention[]; events: ProjectEvent[]; resources: Resource[]; submissions: Submission[];
  requirements: { id: string; taskId: string; title: string; verified: number }[];
  dependencies: { taskId: string; predecessorId: string; type: string }[];
}
export type Thread = { task: Task; messages: { seq: number; authorId: string; authorName: string; authorRole: string; body: string; attachmentUrl: string; createdAt: string }[]; requests: ClientRequest[] }
export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message) }
}
export async function api<T = { id: string; taskId?: string }>(path = '', method = 'GET', data?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/workspace${path}`, {
    method, credentials: 'same-origin', signal,
    ...(data ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) } : {}),
  })
  const result = await response.json()
  if (!response.ok) throw new ApiError(result.error || 'Something went wrong.', response.status)
  return result
}
