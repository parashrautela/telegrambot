import type { Snapshot, Staff } from './api';
import type { ModalName } from './Dialogs';
import { api } from './api';
import { Plus, LockKeyhole } from 'lucide-react';
import { Avatar, Badge } from './components';

type Props = {
  founder: boolean;
  openModal: (value: ModalName) => void;
  snapshot: Snapshot;
  members: Staff[];
  busy: boolean;
  perform: (work: () => Promise<unknown>, close?: boolean) => Promise<void>;
  projectId: string;
  setDisableId: (value: string) => void;
};

export function TeamView({
  founder,
  openModal,
  snapshot,
  members,
  busy,
  perform,
  projectId,
  setDisableId,
}: Props) {
  return (
    <div className="content-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">PROJECT ACCESS</span>
          <h2>The people behind the work</h2>
        </div>
        {founder && (
          <button className="primary-button" onClick={() => openModal('employee')}>
            <Plus size={15} />
            Add employee
          </button>
        )}
      </div>
      <div className="info-note">
        <LockKeyhole size={16} />
        <p>
          Removing a member revokes this project only. Disabling their account revokes all access
          and ends their sessions.
        </p>
      </div>
      {(founder ? snapshot.users : members).map((user) => {
        const assigned = members.some((member) => member.id === user.id);
        return (
          <article className="team-row" key={user.id}>
            <Avatar name={user.name} />
            <div>
              <strong>{user.name}</strong>
              <small>
                {user.role} · {user.id}
                {!user.active ? ' · Disabled' : ''}
              </small>
            </div>
            {user.role === 'Founder' ? (
              <span className="muted">Founder access</span>
            ) : founder && user.active ? (
              <div className="team-actions">
                <button
                  className={assigned ? 'secondary-button' : 'primary-button'}
                  disabled={busy}
                  onClick={() => {
                    void perform(
                      () =>
                        api(`/projects/${projectId}/members`, 'POST', {
                          userId: user.id,
                          add: !assigned,
                        }),
                      false,
                    );
                  }}
                >
                  {assigned ? 'Remove from project' : 'Add to project'}
                </button>
                <button
                  className="text-danger"
                  onClick={() => {
                    setDisableId(user.id);
                    openModal('disable');
                  }}
                >
                  Disable account
                </button>
              </div>
            ) : (
              <Badge value={user.active ? 'Assigned' : 'Disabled'} />
            )}
          </article>
        );
      })}
    </div>
  );
}
