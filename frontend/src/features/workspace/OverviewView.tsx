import type { Project, Task, Staff, Snapshot } from './api';
import type { ModalName } from './Dialogs';
import { ArrowUpRight } from 'lucide-react';
import { Badge } from './components';

type Props = {
  founder: boolean;
  project: Project;
  openModal: (value: ModalName) => void;
  projectTasks: Task[];
  members: Staff[];
  snapshot: Snapshot;
  selectThread: (task: Task) => void;
};

export function OverviewView({
  founder,
  project,
  openModal,
  projectTasks,
  members,
  snapshot,
  selectThread,
}: Props) {
  return (
    <div className="content-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">THE BIG PICTURE</span>
          <h2>One project. Everyone in sync.</h2>
        </div>
        {founder && project.status === 'Setup' && (
          <button className="primary-button" onClick={() => openModal('activate')}>
            Choose workflow
            <ArrowUpRight size={15} />
          </button>
        )}
      </div>
      <div className="overview-stats">
        <article>
          <span>Client</span>
          <strong>{project.clientName}</strong>
          <small>Communication through Telegram</small>
        </article>
        <article>
          <span>Work</span>
          <strong>
            {projectTasks.filter((t) => t.status === 'Resolved').length} / {projectTasks.length}
          </strong>
          <small>Tasks and queries resolved</small>
        </article>
        <article>
          <span>Team</span>
          <strong>{members.length}</strong>
          <small>People with project access</small>
        </article>
      </div>
      <div className="overview-card">
        <h3>Project workflow</h3>
        <p>
          {snapshot.workflows.find((w) => w.id === project.workflowId)?.label ||
            'Client assigned. Choose a workflow to start the project.'}
        </p>
        <small>
          These threads track internal work. Existing Telegram/Sheets tasks remain separate.
        </small>
      </div>
      <div className="overview-card">
        <h3>Next actions</h3>
        {projectTasks
          .filter((t) => t.status !== 'Resolved')
          .slice(0, 5)
          .map((task) => (
            <button className="next-action" key={task.id} onClick={() => selectThread(task)}>
              <span>
                <strong>{task.title}</strong>
                <small>{task.nextAction}</small>
              </span>
              <Badge value={task.status} />
              <ArrowUpRight size={15} />
            </button>
          ))}
        {!projectTasks.length && (
          <p>Add team members, then choose a workflow to generate task threads.</p>
        )}
      </div>
    </div>
  );
}
