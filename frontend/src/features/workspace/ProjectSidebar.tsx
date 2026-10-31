import { X, ShieldCheck, Plus, Search, Users, MessageCircle, LogOut } from 'lucide-react';
import { initials } from './format';
import { Avatar } from './components';
import type { Snapshot } from './api';
import type { ModalName } from './Dialogs';

type Props = {
  showProjects: boolean;
  setShowProjects: (value: boolean) => void;
  founder: boolean;
  openModal: (value: ModalName) => void;
  query: string;
  setQuery: (value: string) => void;
  snapshot: Snapshot;
  projectId: string;
  selectProject: (id: string) => void;
  busy: boolean;
  logout: () => Promise<void>;
};

export function ProjectSidebar({
  showProjects,
  setShowProjects,
  founder,
  openModal,
  query,
  setQuery,
  snapshot,
  projectId,
  selectProject,
  busy,
  logout,
}: Props) {
  return (
    <aside className={`project-sidebar ${showProjects ? 'mobile-open' : ''}`}>
      <div className="studio-heading">
        <div className="studio-wordmark">
          iksha<span>.</span>
          <small>SPACES, THOUGHTFULLY MADE</small>
        </div>
        <button
          className="icon-button mobile-only"
          onClick={() => setShowProjects(false)}
          aria-label="Close projects"
        >
          <X size={18} />
        </button>
      </div>
      <div className="workspace-label">
        <ShieldCheck size={15} />
        Internal workspace
        <span className="online-dot" />
      </div>
      <div className="sidebar-section">
        <span className="eyebrow">YOUR PROJECTS</span>
        {founder && (
          <button
            className="icon-button"
            onClick={() => openModal('project')}
            aria-label="Add project"
          >
            <Plus size={17} />
          </button>
        )}
      </div>
      <label className="search-input">
        <Search size={14} />
        <input
          placeholder="Find a project…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Find a project"
        />
      </label>
      <nav className="project-navigation" aria-label="Projects">
        {snapshot.projects
          .filter((p) => `${p.name} ${p.clientName}`.toLowerCase().includes(query.toLowerCase()))
          .map((p) => (
            <button
              key={p.id}
              className={`project-item ${p.id === projectId ? 'selected' : ''}`}
              onClick={() => selectProject(p.id)}
            >
              <span className="project-monogram">{initials(p.name)}</span>
              <span>
                <strong>{p.name}</strong>
                <small>
                  {p.clientName} · {p.status}
                </small>
              </span>
              {p.unread > 0 && <span className="count-badge">{p.unread}</span>}
            </button>
          ))}
        {!snapshot.projects.length && (
          <p className="sidebar-hint">
            {founder
              ? 'Add a client, then create your first project.'
              : 'Your assigned projects will appear here.'}
          </p>
        )}
      </nav>
      {founder && (
        <div className="sidebar-actions">
          <button onClick={() => openModal('client')}>
            <Users size={15} />
            Add client<span>{snapshot.clients.length}</span>
          </button>
          <button onClick={() => openModal('employee')}>
            <Plus size={15} />
            Add employee
          </button>
        </div>
      )}
      <div className="sidebar-note">
        <MessageCircle size={16} />
        <p>
          Clients on Telegram.
          <br />
          <strong>Your team, together here.</strong>
        </p>
      </div>
      <div className="signed-in-user">
        <Avatar name={snapshot.user.name} small />
        <div>
          <strong>{snapshot.user.name}</strong>
          <small>
            {snapshot.user.role} · {snapshot.user.id}
          </small>
        </div>
        <button
          className="icon-button"
          aria-label="Sign out"
          disabled={busy}
          onClick={() => {
            void logout();
          }}
        >
          <LogOut size={15} />
        </button>
      </div>
    </aside>
  );
}
