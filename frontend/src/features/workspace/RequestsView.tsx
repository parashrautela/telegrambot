import type { ClientRequest, Snapshot, Task } from './api';
import type { ModalName } from './Dialogs';
import { Plus, ShieldCheck, ArrowUpRight } from 'lucide-react';
import { Badge, Attachments, Empty } from './components';
import { date } from './format';

type Props = {
  pending: ClientRequest[];
  openModal: (value: ModalName) => void;
  projectRequests: ClientRequest[];
  setError: (value: string) => void;
  setReview: (value: ClientRequest | null) => void;
  snapshot: Snapshot;
  selectThread: (task: Task) => void;
};

export function RequestsView({
  pending,
  openModal,
  projectRequests,
  setError,
  setReview,
  snapshot,
  selectThread,
}: Props) {
  return (
    <div className="content-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">FOUNDER REVIEW</span>
          <h2>
            Client requests <span className="muted">{pending.length} need attention</span>
          </h2>
        </div>
        <button className="primary-button" onClick={() => openModal('request')}>
          <Plus size={15} />
          Record request
        </button>
      </div>
      <div className="info-note">
        <ShieldCheck size={16} />
        <p>
          Requests stay here until reviewed. Approve and assign work to make it visible in a team
          task thread.
        </p>
      </div>
      {projectRequests.map((request) => (
        <article className="request-card" key={request.id}>
          <header>
            <span>
              {request.type} · {request.source}
            </span>
            <Badge value={request.status} />
          </header>
          <h3>{request.sender}</h3>
          <p>{request.body}</p>
          {request.context && <p className="muted">{request.context}</p>}
          <Attachments items={request.attachments} />
          {request.reviewNote && <p className="review-note">Review note: {request.reviewNote}</p>}
          <footer>
            <time>{date(request.createdAt)}</time>
            {['Pending', 'Clarification'].includes(request.status) ? (
              <button
                className="primary-button"
                onClick={() => {
                  setError('');
                  setReview(request);
                }}
              >
                Review request
                <ArrowUpRight size={14} />
              </button>
            ) : (
              request.taskId && (
                <button
                  className="secondary-button"
                  onClick={() => {
                    const task = snapshot.tasks.find((t) => t.id === request.taskId);
                    if (task) selectThread(task);
                  }}
                >
                  Open thread
                  <ArrowUpRight size={14} />
                </button>
              )
            )}
          </footer>
        </article>
      ))}
      {!projectRequests.length && (
        <Empty title="A clear inbox">
          Record a client request here, or link this project to Telegram during project setup.
        </Empty>
      )}
    </div>
  );
}
