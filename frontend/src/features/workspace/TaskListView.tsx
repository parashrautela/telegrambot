import type { Project, Task } from './api';
import type { ModalName } from './Dialogs';
import { Plus, ClipboardList, ArrowUpRight } from 'lucide-react';
import { Badge, Empty } from './components';

type Props = {
  founder: boolean;
  project: Project;
  openModal: (value: ModalName) => void;
  projectTasks: Task[];
  selectThread: (task: Task) => void;
};

export function TaskListView({ founder, project, openModal, projectTasks, selectThread }: Props) {
  return (
    <div className="content-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">PROJECT WORK</span>
          <h2>Tasks & tracked queries</h2>
        </div>
        {founder && project.status === 'Active' && (
          <button className="primary-button" onClick={() => openModal('task')}>
            <Plus size={15} />
            New task
          </button>
        )}
      </div>
      <div className="task-table">
        {projectTasks.map((task) => (
          <button key={task.id} onClick={() => selectThread(task)}>
            <ClipboardList size={16} />
            <div>
              <strong>{task.title}</strong>
              <small>{task.stage || task.kind}</small>
            </div>
            <span>{task.ownerName || 'Unassigned'}</span>
            <Badge value={task.status} />
            <ArrowUpRight size={15} />
          </button>
        ))}
      </div>
      {!projectTasks.length && (
        <Empty title="Ready for a workflow">
          Choose a template from Overview to generate the internal task plan.
        </Empty>
      )}
    </div>
  );
}
