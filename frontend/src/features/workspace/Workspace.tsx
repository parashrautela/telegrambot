import { ProjectSidebar } from './ProjectSidebar';
import { Notifications } from './Notifications';
import { Avatar, Badge, Empty, Attachments } from './components';
import { date } from './format';
import { SignIn } from './SignIn';
import { OverviewView } from './OverviewView';
import { TaskListView } from './TaskListView';
import { RequestsView } from './RequestsView';
import { ResourcesView } from './ResourcesView';
import { TeamView } from './TeamView';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  Bell,
  CheckCheck,
  ClipboardList,
  FolderOpen,
  Link2,
  LockKeyhole,
  MessageCircle,
  Plus,
  Search,
  Send,
  X,
} from 'lucide-react';
import { api, ApiError, type ClientRequest, type Snapshot, type Task, type Thread } from './api';
import { WorkspaceDialogs, fields, type ModalName } from './Dialogs';
import { WorkspaceTimeline } from './Timeline';
import './styles/workspace.css';
import './styles/workspace-design.css';

type View =
  'Timeline' | 'Overview' | 'Discussions' | 'Tasks' | 'Client requests' | 'Resources' | 'Team';

function Workspace() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [projectId, setProjectId] = useState(
    () => new URLSearchParams(location.search).get('project') || '',
  );
  const [taskId, setTaskId] = useState(
    () => new URLSearchParams(location.search).get('thread') || '',
  );
  const [view, setView] = useState<View>(() =>
    new URLSearchParams(location.search).has('thread') ? 'Discussions' : 'Timeline',
  );
  const [thread, setThread] = useState<Thread | null>(null);
  const [modal, setModal] = useState<ModalName>(null);
  const [review, setReview] = useState<ClientRequest | null>(null);
  const [disableId, setDisableId] = useState('');
  const [query, setQuery] = useState('');
  const [threadQuery, setThreadQuery] = useState('');
  const [filter, setFilter] = useState('All');
  const [draft, setDraft] = useState('');
  const [attachmentUrl, setAttachmentUrl] = useState('');
  const [showLink, setShowLink] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProjects, setShowProjects] = useState(false);
  const messageList = useRef<HTMLDivElement>(null);
  const lastRead = useRef<Record<string, number>>({});
  const lastOpened = useRef('');
  const sessionGeneration = useRef(0);
  const snapshotRequest = useRef(0);

  const handleError = useCallback((cause: unknown) => {
    if (cause instanceof DOMException && cause.name === 'AbortError') return;
    if (cause instanceof ApiError && cause.status === 401) {
      sessionGeneration.current++;
      setSnapshot(null);
      setThread(null);
      lastRead.current = {};
      lastOpened.current = '';
      setModal(null);
      setReview(null);
      setDraft('');
      setAttachmentUrl('');
    }
    setError(cause instanceof Error ? cause.message : 'Could not complete this action.');
  }, []);
  const refresh = useCallback(async () => {
    const generation = sessionGeneration.current;
    const request = ++snapshotRequest.current;
    const data = await api<Snapshot>();
    if (generation !== sessionGeneration.current || request !== snapshotRequest.current) return;
    setSnapshot(data);
    setProjectId((current) =>
      data.projects.some((p) => p.id === current) ? current : data.projects[0]?.id || '',
    );
    setTaskId((current) => (data.tasks.some((t) => t.id === current) ? current : ''));
  }, []);
  useEffect(() => {
    void refresh()
      .catch((cause) => {
        if (!(cause instanceof ApiError && cause.status === 401)) handleError(cause);
      })
      .finally(() => setCheckingSession(false));
  }, [refresh, handleError]);
  const signedIn = Boolean(snapshot);
  useEffect(() => {
    if (!signedIn) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh().catch(handleError);
    }, 8000);
    return () => clearInterval(timer);
  }, [signedIn, refresh, handleError]);
  useEffect(() => {
    const search = new URLSearchParams();
    if (projectId) search.set('project', projectId);
    if (taskId) search.set('thread', taskId);
    history.replaceState(null, '', `${location.pathname}${search.size ? `?${search}` : ''}`);
  }, [projectId, taskId]);
  const markViewed = useCallback(
    (data: Thread) => {
      const container = messageList.current;
      const maximum = data.messages.at(-1)?.seq || 0;
      if (
        data.task.id !== taskId ||
        view !== 'Discussions' ||
        document.visibilityState !== 'visible' ||
        !container ||
        container.scrollHeight - container.scrollTop - container.clientHeight > 35 ||
        !maximum ||
        (lastRead.current[data.task.id] || 0) >= maximum
      )
        return;
      lastRead.current[data.task.id] = maximum;
      void api(`/tasks/${data.task.id}/read`, 'POST', { lastSeq: maximum })
        .then(refresh)
        .catch((cause) => {
          delete lastRead.current[data.task.id];
          handleError(cause);
        });
    },
    [refresh, handleError, taskId, view],
  );
  useEffect(() => {
    if (
      !snapshot ||
      !taskId ||
      view !== 'Discussions' ||
      !snapshot.tasks.some((t) => t.id === taskId && t.projectId === projectId)
    ) {
      setThread(null);
      return;
    }
    const controller = new AbortController();
    void api<Thread>(`/tasks/${taskId}`, 'GET', undefined, controller.signal)
      .then((data) => {
        const container = messageList.current;
        const bottom =
          !container || container.scrollHeight - container.scrollTop - container.clientHeight < 35;
        const opening = lastOpened.current !== data.task.id;
        lastOpened.current = data.task.id;
        setThread(data);
        requestAnimationFrame(() => {
          if (controller.signal.aborted) return;
          if ((opening || bottom) && messageList.current)
            messageList.current.scrollTop = messageList.current.scrollHeight;
          markViewed(data);
        });
      })
      .catch(handleError);
    return () => controller.abort();
  }, [taskId, projectId, view, snapshot, markViewed, handleError]);
  useEffect(() => {
    setDraft('');
    setAttachmentUrl('');
    setShowLink(false);
  }, [taskId]);
  useEffect(() => {
    const visible = () => {
      if (thread) markViewed(thread);
      if (document.visibilityState === 'visible' && snapshot) void refresh().catch(handleError);
    };
    document.addEventListener('visibilitychange', visible);
    return () => document.removeEventListener('visibilitychange', visible);
  }, [thread, snapshot, markViewed, refresh, handleError]);

  async function perform(work: () => Promise<unknown>, close = true) {
    setBusy(true);
    setError('');
    try {
      await work();
      if (close) {
        setModal(null);
        setReview(null);
      }
      await refresh();
    } catch (cause) {
      handleError(cause);
    } finally {
      setBusy(false);
    }
  }
  function openModal(value: ModalName) {
    setError('');
    setReview(null);
    setModal(value);
  }
  function selectProject(id: string) {
    setProjectId(id);
    setTaskId('');
    setThread(null);
    setThreadQuery('');
    setFilter('All');
    setView('Timeline');
    setShowProjects(false);
  }
  function navigate(id: string, threadId?: string) {
    setProjectId(id);
    setTaskId(threadId || '');
    setView(threadId ? 'Discussions' : 'Overview');
    setShowNotifications(false);
  }
  function selectThread(task: Task) {
    navigate(task.projectId, task.id);
  }
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = fields(event);
    await perform(async () => {
      await api('/login', 'POST', input);
      sessionGeneration.current++;
    });
  }
  async function logout() {
    setBusy(true);
    try {
      await api('/logout', 'POST', {});
      sessionGeneration.current++;
      setSnapshot(null);
      setThread(null);
      setTaskId('');
      setProjectId('');
      setDraft('');
      setAttachmentUrl('');
      setError('');
      setModal(null);
      setReview(null);
      setShowProjects(false);
      setShowNotifications(false);
      setView('Timeline');
      lastRead.current = {};
      lastOpened.current = '';
    } catch (cause) {
      handleError(cause);
    } finally {
      setBusy(false);
    }
  }

  if (checkingSession)
    return (
      <div className="login-page">
        <p>Opening your workspace…</p>
      </div>
    );
  if (!snapshot) return <SignIn login={login} error={error} busy={busy} />;

  const founder = snapshot.user.role === 'Founder';
  const project = snapshot.projects.find((p) => p.id === projectId);
  const projectTasks = snapshot.tasks.filter((task) => task.projectId === projectId);
  const projectRequests = snapshot.requests.filter((request) => request.projectId === projectId);
  const pending = projectRequests.filter((request) =>
    ['Pending', 'Clarification'].includes(request.status),
  );
  const members = snapshot.users.filter(
    (user) =>
      user.active &&
      (user.role === 'Founder' ||
        snapshot.memberships.some((m) => m.projectId === projectId && m.userId === user.id)),
  );
  const activeTask = projectTasks.find((task) => task.id === taskId);
  const editable = founder || activeTask?.ownerId === snapshot.user.id;
  const visibleTasks = projectTasks.filter(
    (task) =>
      task.title.toLowerCase().includes(threadQuery.toLowerCase()) &&
      (filter === 'All' ||
        (filter === 'My work'
          ? task.ownerId === snapshot.user.id
          : filter === 'Unread'
            ? task.unread > 0
            : task.status === 'Resolved')),
  );
  const unreadMessages = snapshot.tasks.reduce((sum, task) => sum + task.unread, 0);
  const unreadNotifications = snapshot.notificationUnread;

  return (
    <main className="internal-workspace">
      <ProjectSidebar
        showProjects={showProjects}
        setShowProjects={setShowProjects}
        founder={founder}
        openModal={openModal}
        query={query}
        setQuery={setQuery}
        snapshot={snapshot}
        projectId={projectId}
        selectProject={selectProject}
        busy={busy}
        logout={logout}
      />

      <section className="workspace-main">
        <div className="workspace-breadcrumb">
          <span>
            Studio workspace <span>/</span> <strong>{project?.name || 'Projects'}</strong>
          </span>
          <span className="connection-label">
            <span className="connection-dot" />
            Team workspace
          </span>
        </div>
        <header className="project-header">
          <div className="project-title">
            <button
              className="icon-button mobile-only"
              onClick={() => setShowProjects(true)}
              aria-label="Open projects"
            >
              <FolderOpen size={20} />
            </button>
            <span className="eyebrow">PROJECT WORKSPACE</span>
            <h1>{project?.name || 'Welcome to Studio Iksha'}</h1>
            <p>
              {project
                ? `${project.clientName}${project.location ? ` · ${project.location}` : ''}`
                : 'Start with the client. Build the project around them.'}
            </p>
          </div>
          <div className="header-actions">
            {project && <Badge value={project.status} />}
            <button
              className="notification-toggle"
              onClick={() => setShowNotifications(!showNotifications)}
              aria-label={`Notifications, ${unreadNotifications} unread events`}
            >
              <Bell size={18} />
              {unreadNotifications > 0 && <span>{unreadNotifications}</span>}
            </button>
          </div>
        </header>
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button className="icon-button" onClick={() => setError('')} aria-label="Dismiss error">
              <X size={16} />
            </button>
          </div>
        )}
        {project ? (
          <>
            <div className="project-pulse">
              <article>
                <span>Project progress</span>
                <strong>
                  {projectTasks.length
                    ? Math.round(
                        (projectTasks.filter((t) => t.status === 'Resolved').length /
                          projectTasks.length) *
                          100,
                      )
                    : 0}
                  %
                </strong>
                <small>
                  {projectTasks.filter((t) => t.status === 'Resolved').length} of{' '}
                  {projectTasks.length} work items resolved
                </small>
              </article>
              <article>
                <span>Connected stages</span>
                <strong>
                  {String(new Set(projectTasks.map((t) => t.stage || t.kind)).size).padStart(
                    2,
                    '0',
                  )}
                </strong>
                <small>From first brief to final detail</small>
              </article>
              <article>
                <span>{founder ? 'Awaiting review' : 'My open work'}</span>
                <strong>
                  {String(
                    founder
                      ? pending.length
                      : projectTasks.filter(
                          (t) => t.ownerId === snapshot.user.id && t.status !== 'Resolved',
                        ).length,
                  ).padStart(2, '0')}
                </strong>
                <small>
                  {founder ? 'Client requests to review' : 'Assigned work to move forward'}
                </small>
              </article>
              <article>
                <span>Project team</span>
                <strong>{String(members.length).padStart(2, '0')}</strong>
                <small>People behind the work</small>
              </article>
            </div>
            <nav className="project-tabs" aria-label="Project views">
              {(
                [
                  'Timeline',
                  'Overview',
                  'Discussions',
                  'Tasks',
                  ...(founder ? ['Client requests'] : []),
                  'Resources',
                  'Team',
                ] as View[]
              ).map((tab) => (
                <button
                  key={tab}
                  className={view === tab ? 'active' : ''}
                  onClick={() => {
                    setView(tab);
                    if (tab !== 'Discussions') setThread(null);
                  }}
                >
                  {tab}
                  {tab === 'Client requests' && pending.length > 0 && <span>{pending.length}</span>}
                </button>
              ))}
            </nav>
            {view === 'Timeline' && (
              <WorkspaceTimeline
                key={projectId}
                tasks={projectTasks}
                user={snapshot.user}
                openThread={selectThread}
                refresh={refresh}
              />
            )}
            {view === 'Overview' && (
              <OverviewView
                founder={founder}
                project={project}
                openModal={openModal}
                projectTasks={projectTasks}
                members={members}
                snapshot={snapshot}
                selectThread={selectThread}
              />
            )}

            {view === 'Discussions' && (
              <div className={`discussion-layout ${activeTask ? 'has-thread' : ''}`}>
                <section className="thread-list">
                  <div className="thread-list-heading">
                    <div>
                      <h2>Task discussions</h2>
                      <p>A focused space for every piece of work.</p>
                    </div>
                    {founder && project.status === 'Active' && (
                      <button
                        className="icon-button"
                        onClick={() => openModal('task')}
                        aria-label="Create task"
                      >
                        <Plus size={18} />
                      </button>
                    )}
                  </div>
                  <label className="search-input">
                    <Search size={14} />
                    <input
                      value={threadQuery}
                      onChange={(event) => setThreadQuery(event.target.value)}
                      placeholder="Find a task or query…"
                      aria-label="Search discussions"
                    />
                  </label>
                  <div className="thread-filters">
                    {['All', 'My work', 'Unread', 'Resolved'].map((value) => (
                      <button
                        className={filter === value ? 'active' : ''}
                        key={value}
                        onClick={() => setFilter(value)}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                  <div className="thread-cards">
                    {visibleTasks.map((task) => (
                      <button
                        className={`thread-card ${taskId === task.id ? 'selected' : ''}`}
                        key={task.id}
                        onClick={() => selectThread(task)}
                      >
                        <div className="thread-card-top">
                          <span>
                            {task.kind === 'Query' ? (
                              <MessageCircle size={13} />
                            ) : (
                              <ClipboardList size={13} />
                            )}
                            {task.stage || task.kind}
                          </span>
                          {task.unread > 0 && <span className="count-badge">{task.unread}</span>}
                        </div>
                        <h3>{task.title}</h3>
                        <p>{task.decision || task.blocker || task.nextAction}</p>
                        <div className="thread-card-bottom">
                          <span>{task.ownerName || 'Unassigned'}</span>
                          <Badge value={task.status} />
                        </div>
                      </button>
                    ))}
                    {!visibleTasks.length && (
                      <div className="thread-list-empty">
                        <p>
                          {project.status === 'Setup'
                            ? 'The client is assigned. Choose a workflow to create task discussions.'
                            : 'No discussions match this view.'}
                        </p>
                        {founder && project.status === 'Setup' && (
                          <button className="primary-button" onClick={() => openModal('activate')}>
                            Choose workflow
                            <ArrowUpRight size={14} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </section>
                {activeTask ? (
                  <section className="task-thread">
                    <header className="task-thread-heading">
                      <button
                        className="icon-button thread-back"
                        onClick={() => {
                          setTaskId('');
                          setThread(null);
                        }}
                        aria-label="Back to task discussions"
                      >
                        <ArrowLeft size={18} />
                      </button>
                      <div>
                        <span className="eyebrow">
                          {activeTask.kind.toUpperCase()} THREAD · INTERNAL ONLY
                        </span>
                        <h2>{activeTask.title}</h2>
                        <p>
                          {activeTask.ownerName || 'Unassigned'} ·{' '}
                          {activeTask.stage || 'Client request'}
                        </p>
                      </div>
                      <Badge value={activeTask.status} />
                    </header>
                    <section className="thread-tldr">
                      <div>
                        <span className="eyebrow">THREAD TLDR</span>
                        {editable && (
                          <button onClick={() => openModal('summary')}>
                            Update summary
                            <ArrowUpRight size={12} />
                          </button>
                        )}
                      </div>
                      <p>
                        <strong>Decision</strong>
                        {activeTask.decision || 'No decision recorded yet.'}
                      </p>
                      {activeTask.blocker && (
                        <p>
                          <strong>Blocker</strong>
                          {activeTask.blocker}
                        </p>
                      )}
                      <p>
                        <strong>Next</strong>
                        {activeTask.nextAction || 'Agree on the next action.'}
                      </p>
                    </section>
                    <div
                      className="thread-messages"
                      ref={messageList}
                      onScroll={() => {
                        if (thread) markViewed(thread);
                      }}
                      aria-label="Internal thread messages"
                    >
                      {thread?.task.id === activeTask.id ? (
                        <>
                          {thread.requests.map((request) => (
                            <article className="source-request" key={request.id}>
                              <span className="eyebrow">
                                APPROVED CLIENT {request.type.toUpperCase()} ·{' '}
                                {request.source.toUpperCase()}
                              </span>
                              <strong>{request.sender}</strong>
                              <p>{request.body}</p>
                              {request.context && <p>{request.context}</p>}
                              <Attachments items={request.attachments} />
                            </article>
                          ))}
                          {!thread.messages.length && (
                            <div className="conversation-start">
                              <MessageCircle size={24} />
                              <h3>Start the discussion</h3>
                              <p>
                                Share an update, ask the team, or record the next step.
                                <br />
                                Only the internal project team can read this thread.
                              </p>
                            </div>
                          )}
                          {thread.messages.map((message) => (
                            <article
                              className={`internal-message ${message.authorId === snapshot.user.id ? 'mine' : ''}`}
                              key={message.seq}
                            >
                              <Avatar name={message.authorName} small />
                              <div>
                                <header>
                                  <strong>{message.authorName}</strong>
                                  <span>{message.authorRole}</span>
                                  <time>{date(message.createdAt)}</time>
                                </header>
                                <p>{message.body}</p>
                                {message.attachmentUrl && (
                                  <Attachments
                                    items={[{ type: 'Link', url: message.attachmentUrl }]}
                                  />
                                )}
                              </div>
                            </article>
                          ))}
                        </>
                      ) : (
                        <p className="loading-thread">Loading discussion…</p>
                      )}
                    </div>
                    {activeTask.status === 'Resolved' ? (
                      <div className="resolved-footer">
                        <CheckCheck size={16} />
                        This thread is resolved.
                        {editable && (
                          <button
                            onClick={() => {
                              void perform(
                                () => api(`/tasks/${activeTask.id}`, 'PATCH', { status: 'Open' }),
                                false,
                              );
                            }}
                          >
                            Reopen discussion
                          </button>
                        )}
                      </div>
                    ) : (
                      <form
                        className="internal-composer"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void perform(async () => {
                            await api(`/tasks/${activeTask.id}/messages`, 'POST', {
                              body: draft,
                              attachmentUrl,
                            });
                            setDraft('');
                            setAttachmentUrl('');
                            setShowLink(false);
                          }, false);
                        }}
                      >
                        <textarea
                          value={draft}
                          onChange={(event) => setDraft(event.target.value)}
                          placeholder="Share an update with the project team…"
                          aria-label="Write an internal message"
                          rows={2}
                          required
                          maxLength={10000}
                        />
                        {showLink && (
                          <input
                            value={attachmentUrl}
                            onChange={(event) => setAttachmentUrl(event.target.value)}
                            placeholder="https://… reference image or document"
                            type="url"
                            aria-label="Attachment URL"
                          />
                        )}
                        <footer>
                          <button
                            className={`icon-button ${showLink ? 'selected' : ''}`}
                            type="button"
                            onClick={() => setShowLink(!showLink)}
                            aria-label="Add attachment URL"
                          >
                            <Link2 size={17} />
                          </button>
                          <span>
                            <LockKeyhole size={11} />
                            Internal project discussion
                          </span>
                          <button className="primary-button" disabled={busy || !draft.trim()}>
                            {busy ? 'Sending…' : 'Send'}
                            <Send size={14} />
                          </button>
                        </footer>
                      </form>
                    )}
                  </section>
                ) : (
                  <Empty title="Good work starts with a clear conversation.">
                    Choose a task on the left to see its decisions, next steps, and team discussion.
                  </Empty>
                )}
              </div>
            )}

            {view === 'Tasks' && (
              <TaskListView
                founder={founder}
                project={project}
                openModal={openModal}
                projectTasks={projectTasks}
                selectThread={selectThread}
              />
            )}
            {view === 'Client requests' && founder && (
              <RequestsView
                pending={pending}
                openModal={openModal}
                projectRequests={projectRequests}
                setError={setError}
                setReview={setReview}
                snapshot={snapshot}
                selectThread={selectThread}
              />
            )}
            {view === 'Resources' && (
              <ResourcesView projectTasks={projectTasks} selectThread={selectThread} />
            )}
            {view === 'Team' && (
              <TeamView
                founder={founder}
                openModal={openModal}
                snapshot={snapshot}
                members={members}
                busy={busy}
                perform={perform}
                projectId={projectId}
                setDisableId={setDisableId}
              />
            )}
          </>
        ) : (
          <div className="welcome-page">
            <span className="eyebrow">A FRESH START</span>
            <h2>
              Every project starts
              <br />
              with a client.
            </h2>
            <p>
              {founder
                ? 'Add your client, choose the project workflow, and bring the right people into the conversation.'
                : 'The founder will assign you to a project. Your tasks and discussions will appear here.'}
            </p>
            {founder && (
              <div>
                <button
                  className="primary-button"
                  onClick={() => openModal(snapshot.clients.length ? 'project' : 'client')}
                >
                  <Plus size={16} />
                  {snapshot.clients.length ? 'Create project' : 'Add first client'}
                </button>
                {snapshot.clients.length > 0 && (
                  <button className="secondary-button" onClick={() => openModal('client')}>
                    Add client
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      <Notifications
        showNotifications={showNotifications}
        setShowNotifications={setShowNotifications}
        unreadMessages={unreadMessages}
        unreadNotifications={unreadNotifications}
        snapshot={snapshot}
        busy={busy}
        perform={perform}
        selectThread={selectThread}
        navigate={navigate}
        setView={setView}
      />
      <WorkspaceDialogs
        modal={modal}
        review={review}
        disableId={disableId}
        snapshot={snapshot}
        projectId={projectId}
        activeTask={activeTask}
        busy={busy}
        error={error}
        setModal={openModal}
        close={() => {
          setModal(null);
          setReview(null);
          setError('');
        }}
        perform={perform}
        navigate={navigate}
      />
    </main>
  );
}
export default Workspace;
