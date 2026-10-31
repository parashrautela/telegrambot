import { Bell, X, CheckCheck, LockKeyhole } from 'lucide-react';
import { api } from './api';
import { date } from './format';
import type { Snapshot, Task } from './api';

type Props = {
  showNotifications: boolean;
  setShowNotifications: (value: boolean) => void;
  unreadMessages: number;
  unreadNotifications: number;
  snapshot: Snapshot;
  busy: boolean;
  perform: (work: () => Promise<unknown>, close?: boolean) => Promise<void>;
  selectThread: (task: Task) => void;
  navigate: (id: string, threadId?: string) => void;
  setView: (value: 'Client requests') => void;
};

export function Notifications({
  showNotifications,
  setShowNotifications,
  unreadMessages,
  unreadNotifications,
  snapshot,
  busy,
  perform,
  selectThread,
  navigate,
  setView,
}: Props) {
  return (
    <aside
      className={`notification-rail ${showNotifications ? 'mobile-open' : ''}`}
      aria-label="Notifications"
      aria-hidden={!showNotifications}
    >
      <header>
        <div>
          <Bell size={16} />
          <h2>Notifications</h2>
        </div>
        <button
          className="icon-button"
          onClick={() => setShowNotifications(false)}
          aria-label="Close notifications"
        >
          <X size={16} />
        </button>
      </header>
      <div className="notification-summary">
        <strong>{unreadMessages}</strong>
        <span>
          unread messages
          <br />
          <small>{unreadNotifications} unread alerts</small>
        </span>
      </div>
      <div className="rail-section">
        <span className="eyebrow">NEEDS YOUR ATTENTION</span>
        <div className="notification-list">
          {snapshot.notifications
            .filter((n) => !n.readAt)
            .map((notification) => (
              <button
                className="notification-item"
                key={notification.id}
                disabled={busy}
                onClick={() => {
                  void perform(async () => {
                    await api(`/notifications/${notification.id}/read`, 'POST', {});
                    if (notification.taskId) {
                      const task = snapshot.tasks.find((t) => t.id === notification.taskId);
                      if (task) selectThread(task);
                    } else {
                      navigate(notification.projectId);
                      setView('Client requests');
                    }
                  }, false);
                }}
              >
                <span className="notification-dot" />
                <div>
                  <strong>{notification.kind}</strong>
                  <p>{notification.body}</p>
                  <small>
                    {snapshot.projects.find((p) => p.id === notification.projectId)?.name} ·{' '}
                    {date(notification.createdAt)}
                  </small>
                </div>
              </button>
            ))}
          {!unreadNotifications && (
            <div className="notifications-empty">
              <CheckCheck size={24} />
              <strong>You’re all caught up.</strong>
              <p>Assignments and team updates will appear here.</p>
            </div>
          )}
        </div>
      </div>
      <div className="rail-footer">
        <LockKeyhole size={12} />
        Visible only to your internal team.
      </div>
    </aside>
  );
}
