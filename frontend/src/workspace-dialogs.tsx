import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Check, X } from 'lucide-react'
import { api, type ClientRequest, type Snapshot, type Task } from './workspace-api'

export type ModalName = 'client' | 'project' | 'activate' | 'employee' | 'request' | 'task' | 'summary' | 'disable' | null
export const fields = (event: FormEvent<HTMLFormElement>) => Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>
function Dialog({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close() }, [])
  return <dialog ref={ref} onCancel={close} className="workspace-dialog"><div className="dialog-heading"><h2>{title}</h2><button className="icon-button" onClick={close} aria-label="Close dialog"><X size={18} /></button></div>{children}</dialog>
}
type Props = {
  modal: ModalName; review: ClientRequest | null; disableId: string; snapshot: Snapshot; projectId: string; activeTask?: Task;
  busy: boolean; error: string; setModal: (value: ModalName) => void; close: () => void;
  perform: (work: () => Promise<unknown>, close?: boolean) => Promise<void>;
  navigate: (projectId: string, taskId?: string) => void;
}
export function WorkspaceDialogs({ modal, review, disableId, snapshot, projectId, activeTask, busy, error, setModal, close, perform, navigate }: Props) {
  const [decision, setDecision] = useState('Approved')
  useEffect(() => setDecision('Approved'), [review?.id])
  if (!modal && !review) return null
  const project = snapshot.projects.find((p) => p.id === projectId)
  const members = snapshot.users.filter((user) => user.active && (user.role === 'Founder' || snapshot.memberships.some((m) => m.projectId === projectId && m.userId === user.id)))
  const footer = <div className="dialog-footer"><button type="button" className="secondary-button" onClick={close}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Save'}<Check size={14} /></button></div>
  const ownerSelect = <label>Owner<select name="ownerId" required defaultValue={snapshot.user.id}>{members.map((user) => <option key={user.id} value={user.id}>{user.name} · {user.role}</option>)}</select></label>
  const submit = (endpoint: string, method = 'POST') => (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const input = fields(event); void perform(() => api(endpoint, method, modal === 'summary' && activeTask ? { ...input, version: activeTask.version } : input)) }
  const titles = { client: 'Add a client', project: 'Create a project', activate: 'Choose project workflow', employee: 'Create employee account', request: 'Record a client request', task: 'Create task or query', summary: 'Update thread summary', disable: 'Disable employee account' }
  return <Dialog title={review ? 'Review client request' : titles[modal!]} close={close}>
    {error && <p className="form-error" role="alert">{error}</p>}
    {modal === 'client' && <form onSubmit={submit('/clients')}>
      <p className="form-description">Clients communicate through Telegram. This record does not create a web account.</p>
      <label>Client name<input name="name" required maxLength={200} autoFocus /></label>
      <label>Telegram user ID <span className="muted">optional</span><input name="telegramId" inputMode="numeric" pattern="[0-9]+" /></label>{footer}
    </form>}
    {modal === 'project' && <form onSubmit={(event) => { event.preventDefault(); const input = fields(event); void perform(async () => { const result = await api('/projects', 'POST', input); navigate(result.id) }) }}>
      <label>Assign client<select name="clientId" required defaultValue=""><option value="" disabled>Select a client first</option>{snapshot.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
      {!snapshot.clients.length && <p className="form-description">Add a client before creating a project. <button type="button" className="inline-link" onClick={() => setModal('client')}>Add client</button></p>}
      <label>Project name<input name="name" required maxLength={200} /></label><label>Location <span className="muted">optional</span><input name="location" maxLength={200} /></label>
      <details><summary>Link an existing Telegram project</summary><p className="form-description">For request intake. Existing bot workflow tasks stay in Sheets.</p><label>Bot project ID<input name="telegramProjectId" placeholder="P001" maxLength={80} /></label><label>Telegram group ID<input name="groupChatId" placeholder="-100…" pattern="-[0-9]+" /></label></details>{footer}
    </form>}
    {modal === 'activate' && <form onSubmit={submit(`/projects/${projectId}/activate`)}>
      <p className="form-description">Client: <strong>{project?.clientName}</strong>. This creates the work plan once.</p>
      <label>Workflow template<select name="workflowId" required>{snapshot.workflows.map((w) => <option key={w.id} value={w.id}>{w.label} · {w.taskCount} tasks</option>)}</select></label>{ownerSelect}<label>Project start date<input name="startDate" type="date" /></label>
      <p className="form-description">The owner coordinates these tasks, including client input through Telegram. Reassign individual tasks later.</p>{footer}
    </form>}
    {modal === 'employee' && <form onSubmit={submit('/users')}>
      <label>Full name<input name="name" required maxLength={200} autoFocus /></label><label>Individual staff ID<input name="id" required maxLength={64} pattern="[a-zA-Z0-9._-]+" autoComplete="off" placeholder="neha.shah" /></label>
      <label>Role<select name="role"><option>Designer</option><option>Site supervisor</option><option>Project lead</option><option>Employee</option></select></label><label>Password<input name="password" required type="password" minLength={12} maxLength={256} autoComplete="new-password" /></label>
      <p className="form-description">At least 12 characters. Add the employee to their projects from Team after creating the account.</p>{footer}
    </form>}
    {modal === 'request' && <form onSubmit={submit(`/projects/${projectId}/requests`)}>
      <label>Client / original sender<input name="sender" required defaultValue={project?.clientName} maxLength={200} /></label><label>Request type<select name="type"><option>Question</option><option>Approval</option></select></label><label>Request<textarea name="body" required rows={4} maxLength={10000} /></label><label>Reference URL <span className="muted">optional</span><input name="attachmentUrl" type="url" placeholder="https://…" /></label>{footer}
    </form>}
    {modal === 'task' && <form onSubmit={(event) => { event.preventDefault(); const input = fields(event); void perform(async () => { const result = await api(`/projects/${projectId}/tasks`, 'POST', input); navigate(projectId, result.id) }) }}>
      <label>Title<input name="title" required maxLength={200} autoFocus /></label><label>Work type<select name="kind"><option>Task</option><option>Query</option></select></label>{ownerSelect}{footer}
    </form>}
    {modal === 'summary' && activeTask && <form onSubmit={submit(`/tasks/${activeTask.id}`, 'PATCH')}>
      <label>Status<select name="status" defaultValue={activeTask.status}>{['Open', 'In progress', 'Blocked'].map((value) => <option key={value}>{value}</option>)}</select></label>
      {snapshot.user.role === 'Founder' && <label>Owner<select name="ownerId" required defaultValue={activeTask.ownerId || ''}><option value="" disabled>Select owner</option>{members.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>}
      <label>Latest decision<textarea name="decision" defaultValue={activeTask.decision} rows={2} maxLength={2000} /></label><label>Blocker<textarea name="blocker" defaultValue={activeTask.blocker} rows={2} maxLength={2000} /></label><label>Next action<textarea name="nextAction" defaultValue={activeTask.nextAction} rows={2} maxLength={2000} /></label>{footer}
    </form>}
    {modal === 'disable' && <form onSubmit={(event) => { event.preventDefault(); void perform(() => api(`/users/${encodeURIComponent(disableId)}/disable`, 'POST', {})) }}>
      <p className="form-description">Disable <strong>{disableId}</strong> across all projects and end their active sessions. Messages and history are preserved.</p><div className="dialog-footer"><button type="button" className="secondary-button" onClick={close}>Cancel</button><button className="danger-button" disabled={busy}>Disable account</button></div>
    </form>}
    {review && <><div className="review-source"><strong>{review.sender}</strong><p>{review.body}</p></div><form onSubmit={(event) => { event.preventDefault(); const input = fields(event); void perform(async () => { const result = await api(`/requests/${review.id}/review`, 'POST', input); if (result.taskId) navigate(projectId, result.taskId) }) }}>
      <label>Decision<select name="status" value={decision} onChange={(event) => setDecision(event.target.value)}><option value="Approved">Approve and assign</option><option value="Clarification">Needs clarification</option><option value="Rejected">Reject request</option></select></label>
      <fieldset disabled={decision !== 'Approved'}><label>Link to existing work<select name="taskId"><option value="">Create a new {review.type === 'Question' ? 'query' : 'task'}</option>{snapshot.tasks.filter((t) => t.projectId === projectId && t.status !== 'Resolved').map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label><label>New task/query title<input name="title" defaultValue={review.body.slice(0, 180)} maxLength={200} /></label>{ownerSelect}</fieldset>
      <label>Review note<textarea name="note" rows={2} maxLength={2000} required={decision !== 'Approved'} placeholder="Required for rejection or clarification" /></label><p className="form-description">This is an internal decision. It does not send a Telegram reply or approve a design milestone.</p>{footer}
    </form></>}
  </Dialog>
}
