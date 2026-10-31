import type { Task } from './api';
import { Link2, ArrowUpRight } from 'lucide-react';

type Props = {
  projectTasks: Task[];
  selectThread: (task: Task) => void;
};

export function ResourcesView({ projectTasks, selectThread }: Props) {
  return (
    <div className="content-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">PROJECT REFERENCES</span>
          <h2>Links, images & documents</h2>
        </div>
      </div>
      <div className="info-note">
        <Link2 size={16} />
        <p>
          References live inside task threads. Add an HTTPS link using the link button in a
          discussion; files are not stored by this app.
        </p>
      </div>
      {projectTasks.map((task) => (
        <button className="resource-thread" key={task.id} onClick={() => selectThread(task)}>
          <Link2 size={17} />
          <span>
            {task.title}
            <small>Open thread references</small>
          </span>
          <ArrowUpRight size={16} />
        </button>
      ))}
    </div>
  );
}
