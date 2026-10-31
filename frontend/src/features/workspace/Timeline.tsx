import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  X,
} from 'lucide-react';
import { api, type Staff, type Task } from './api';

const DAY = 86400000;
const HALF_HOUR = 1800000;
const midnight = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate());
const inputDate = (value: Date) =>
  new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const labelDate = (value: Date) => value.toLocaleDateString([], { month: 'short', day: 'numeric' });
type Props = {
  tasks: Task[];
  user: Staff;
  openThread: (task: Task) => void;
  refresh: () => Promise<void>;
};
type Drag = { id: string; x: number; start: number; end: number; resize: boolean; moved: boolean };

export function WorkspaceTimeline({ tasks, user, openThread, refresh }: Props) {
  const orderedTasks = [...tasks].sort((a, b) => a.taskOrder - b.taskOrder);
  const [day, setDay] = useState(() => midnight(new Date()));
  const [hourly, setHourly] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () =>
      new Set(
        [
          ...new Set(
            orderedTasks.map(
              (t) => t.stage || (t.kind === 'Query' ? 'Client queries' : 'Additional work'),
            ),
          ),
        ].slice(1),
      ),
  );
  const [selectedId, setSelectedId] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [moving, setMoving] = useState<{ id: string; start: number; end: number } | null>(null);
  const drag = useRef<Drag | null>(null);
  const dragged = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const selected = tasks.find((t) => t.id === selectedId);
  const canEdit = (task: Task) => user.role === 'Founder' || task.ownerId === user.id;
  const days = Array.from(
    { length: 7 },
    (_, i) => new Date(day.getFullYear(), day.getMonth(), day.getDate() + i),
  );
  const rangeStart = day.getTime();
  const rangeEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 7).getTime();
  const dayWidth = hourly ? 480 : 148;
  const width = dayWidth * 7;
  const scale = width / (rangeEnd - rangeStart);
  const groups = [
    ...new Set(
      orderedTasks.map(
        (t) => t.stage || (t.kind === 'Query' ? 'Client queries' : 'Additional work'),
      ),
    ),
  ];
  const stageOf = (t: Task) =>
    t.stage || (t.kind === 'Query' ? 'Client queries' : 'Additional work');
  const scheduled = tasks.filter((t) => t.scheduledStart && t.scheduledEnd);
  useEffect(() => {
    if (selected) dialog.current?.showModal();
    else dialog.current?.close();
  }, [selectedId, Boolean(selected)]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 3500);
    return () => clearTimeout(timer);
  }, [notice]);

  function open(task: Task) {
    const defaultStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9);
    setStart(inputDate(task.scheduledStart ? new Date(task.scheduledStart) : defaultStart));
    setEnd(
      inputDate(
        task.scheduledEnd
          ? new Date(task.scheduledEnd)
          : new Date(defaultStart.getTime() + 2 * 3600000),
      ),
    );
    setError('');
    setSelectedId(task.id);
  }
  async function save(task: Task, from: string | null, to: string | null, close = false) {
    setSaving(true);
    setError('');
    try {
      await api(`/tasks/${task.id}`, 'PATCH', { scheduledStart: from, scheduledEnd: to });
      await refresh();
      if (close) setSelectedId('');
      setNotice(from ? 'Schedule saved to the project.' : 'Task moved to unscheduled work.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the schedule.');
    } finally {
      setSaving(false);
      setMoving(null);
    }
  }
  function begin(event: PointerEvent<HTMLButtonElement>, task: Task) {
    if (
      !canEdit(task) ||
      saving ||
      !task.scheduledStart ||
      !task.scheduledEnd ||
      event.button !== 0
    )
      return;
    dragged.current = false;
    drag.current = {
      id: task.id,
      x: event.clientX,
      start: Date.parse(task.scheduledStart),
      end: Date.parse(task.scheduledEnd),
      resize: (event.target as HTMLElement).classList.contains('schedule-resize'),
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    const original = drag.current;
    if (!original) return;
    if (Math.abs(event.clientX - original.x) < 5 && !original.moved) return;
    original.moved = true;
    dragged.current = true;
    const shift = Math.round((event.clientX - original.x) / scale / HALF_HOUR) * HALF_HOUR;
    setMoving({
      id: original.id,
      start: original.resize ? original.start : original.start + shift,
      end: original.resize
        ? Math.max(
            original.start + HALF_HOUR,
            Math.min(original.start + 366 * DAY, original.end + shift),
          )
        : original.end + shift,
    });
  }
  function finish(task: Task) {
    const original = drag.current;
    drag.current = null;
    const changed =
      moving && original && (moving.start !== original.start || moving.end !== original.end);
    if (original?.moved && moving && changed)
      void save(task, new Date(moving.start).toISOString(), new Date(moving.end).toISOString());
    else setMoving(null);
  }

  return (
    <div className="content-page timeline-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">EVERY STAGE, CONNECTED</span>
          <h2>Make room for good work.</h2>
          <p className="page-subtitle">Plan the time. See the overlap. Keep ownership clear.</p>
        </div>
        <span className="quiet-label">
          <CalendarDays size={14} />
          {scheduled.length} scheduled · {tasks.length - scheduled.length} to plan
        </span>
      </div>
      <div className="timeline-toolbar">
        <div className="date-navigation">
          <button
            className="icon-button"
            aria-label="Previous week"
            onClick={() => setDay(new Date(day.getFullYear(), day.getMonth(), day.getDate() - 7))}
          >
            <ArrowLeft size={15} />
          </button>
          <strong>
            {labelDate(day)} – {labelDate(days[6])}, {day.getFullYear()}
          </strong>
          <button
            className="icon-button"
            aria-label="Next week"
            onClick={() => setDay(new Date(day.getFullYear(), day.getMonth(), day.getDate() + 7))}
          >
            <ArrowRight size={15} />
          </button>
        </div>
        <button className="secondary-button" onClick={() => setDay(midnight(new Date()))}>
          Today
        </button>
        {scheduled.length > 0 && (
          <button
            className="secondary-button"
            onClick={() =>
              setDay(
                midnight(
                  new Date(Math.min(...scheduled.map((t) => Date.parse(t.scheduledStart!)))),
                ),
              )
            }
          >
            First scheduled
          </button>
        )}
        <div className="view-segment">
          <button className={!hourly ? 'active' : ''} onClick={() => setHourly(false)}>
            Days
          </button>
          <button className={hourly ? 'active' : ''} onClick={() => setHourly(true)}>
            Hours
          </button>
        </div>
        <button
          className="secondary-button"
          onClick={() =>
            setCollapsed(collapsed.size === groups.length ? new Set() : new Set(groups))
          }
        >
          {collapsed.size === groups.length ? 'Expand stages' : 'Collapse stages'}
        </button>
      </div>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      {!tasks.length ? (
        <div className="timeline-empty">
          <CalendarDays size={30} />
          <h3>Your project starts here.</h3>
          <p>Choose a workflow from Overview to create the work items, then schedule them here.</p>
        </div>
      ) : (
        <div className="schedule-scroll" aria-label="Project schedule">
          <div
            className="schedule-grid"
            style={
              { '--schedule-width': `${width}px`, '--day-width': `${dayWidth}px` } as CSSProperties
            }
          >
            <div className="schedule-row schedule-head">
              <div className="schedule-label">STAGE / WORK ITEM</div>
              <div className="schedule-track">
                {days.map((d, i) => (
                  <div
                    key={i}
                    className={`schedule-day ${d.toDateString() === new Date().toDateString() ? 'today' : ''}`}
                    style={{ width: dayWidth }}
                  >
                    <span>
                      {d.toLocaleDateString([], { weekday: 'short' })} <b>{d.getDate()}</b>
                    </span>
                    <small>{d.toLocaleDateString([], { month: 'long' })}</small>
                    {hourly && (
                      <div className="hour-markers">
                        <span>00:00</span>
                        <span>06:00</span>
                        <span>12:00</span>
                        <span>18:00</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
            {groups.map((group, index) => {
              const items = orderedTasks.filter((t) => stageOf(t) === group);
              const dates = items.filter((t) => t.scheduledStart && t.scheduledEnd);
              const from = Math.min(...dates.map((t) => Date.parse(t.scheduledStart!))),
                to = Math.max(...dates.map((t) => Date.parse(t.scheduledEnd!)));
              return (
                <section key={group} className={`stage-group stage-color-${index % 5}`}>
                  <div className="schedule-row stage-heading">
                    <button
                      className="schedule-label"
                      aria-expanded={!collapsed.has(group)}
                      onClick={() =>
                        setCollapsed((current) => {
                          const next = new Set(current);
                          next.has(group) ? next.delete(group) : next.add(group);
                          return next;
                        })
                      }
                    >
                      <span className="stage-number">{String(index + 1).padStart(2, '0')}</span>
                      <span>
                        <strong>{group}</strong>
                        <small>
                          {items.length} work items ·{' '}
                          {items.filter((t) => t.status === 'Resolved').length} resolved
                        </small>
                      </span>
                      {collapsed.has(group) ? (
                        <ChevronRight size={14} />
                      ) : (
                        <ChevronDown size={14} />
                      )}
                    </button>
                    <div className="schedule-track">
                      {dates.length > 0 && to > rangeStart && from < rangeEnd && (
                        <div
                          className="stage-span"
                          style={{
                            left: Math.max(0, from - rangeStart) * scale,
                            width: (Math.min(to, rangeEnd) - Math.max(from, rangeStart)) * scale,
                          }}
                        />
                      )}
                    </div>
                  </div>
                  {!collapsed.has(group) &&
                    items.map((task) => {
                      const from =
                        moving?.id === task.id
                          ? moving.start
                          : Date.parse(task.scheduledStart || '');
                      const to =
                        moving?.id === task.id ? moving.end : Date.parse(task.scheduledEnd || '');
                      const hasSchedule = Number.isFinite(from) && Number.isFinite(to);
                      // A bar being dragged stays mounted even past the window edge, so its pointer handlers always receive the release.
                      const dragging = moving?.id === task.id;
                      const visible =
                        hasSchedule && (dragging || (to > rangeStart && from < rangeEnd));
                      const left = Math.min(width - 6, Math.max(0, from - rangeStart) * scale);
                      return (
                        <div key={task.id} className="schedule-row task-schedule-row">
                          <button className="schedule-label" onClick={() => open(task)}>
                            <span
                              className={`task-state state-${task.status.toLowerCase().replaceAll(' ', '-')}`}
                            >
                              {task.status === 'Resolved' ? <Check size={11} /> : null}
                            </span>
                            <span>
                              <strong>{task.title}</strong>
                              <small>
                                {task.ownerName || 'Unassigned'} · {task.status}
                              </small>
                            </span>
                          </button>
                          <div className="schedule-track">
                            {visible ? (
                              <button
                                key="bar"
                                className={`schedule-bar ${task.status === 'Resolved' ? 'is-resolved' : ''} ${canEdit(task) ? 'is-editable' : ''}`}
                                style={{
                                  left,
                                  width: Math.max(
                                    6,
                                    Math.min(
                                      width - left,
                                      (Math.min(to, rangeEnd) - Math.max(from, rangeStart)) *
                                        scale -
                                        2,
                                    ),
                                  ),
                                }}
                                title={`${task.title} · ${new Date(from).toLocaleString()} → ${new Date(to).toLocaleString()}`}
                                aria-label={`Schedule ${task.title}`}
                                onPointerDown={(e) => begin(e, task)}
                                onPointerMove={move}
                                onPointerUp={() => finish(task)}
                                onLostPointerCapture={() => {
                                  if (drag.current) finish(task);
                                }}
                                onPointerCancel={() => {
                                  drag.current = null;
                                  dragged.current = true;
                                  setMoving(null);
                                }}
                                onClick={() => {
                                  if (!dragged.current) open(task);
                                  dragged.current = false;
                                }}
                              >
                                <span>{task.title}</span>
                                {canEdit(task) && to <= rangeEnd && (
                                  <i className="schedule-resize" aria-hidden="true">
                                    ⋮
                                  </i>
                                )}
                              </button>
                            ) : (
                              <button
                                key="chip"
                                className="unscheduled-task"
                                onClick={() => {
                                  if (hasSchedule) setDay(midnight(new Date(from)));
                                  else open(task);
                                }}
                              >
                                <Clock3 size={12} />
                                {hasSchedule
                                  ? `${labelDate(new Date(from))} → ${labelDate(new Date(to))} · Show`
                                  : canEdit(task)
                                    ? 'Set a time'
                                    : 'Not scheduled'}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                </section>
              );
            })}
          </div>
        </div>
      )}
      <div className="schedule-caption">
        <span>
          Drag a block to move it · Pull its edge to resize · Click to edit or open its discussion
        </span>
        <span>Local time · {Intl.DateTimeFormat().resolvedOptions().timeZone}</span>
      </div>
      <dialog
        ref={dialog}
        className="workspace-dialog schedule-dialog"
        aria-labelledby="schedule-title"
        onCancel={(e) => {
          if (saving) e.preventDefault();
          else setSelectedId('');
        }}
      >
        {selected && (
          <>
            <div className="dialog-heading">
              <span className="eyebrow">{selected.stage || selected.kind}</span>
              <button
                className="icon-button"
                aria-label="Close schedule"
                disabled={saving}
                onClick={() => setSelectedId('')}
              >
                <X size={18} />
              </button>
            </div>
            <h2 id="schedule-title">{selected.title}</h2>
            <p className="schedule-owner">
              {selected.ownerName || 'Unassigned'} <span>· {selected.status}</span>
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const input = new FormData(e.currentTarget);
                const from = String(input.get('starts') || ''),
                  to = String(input.get('ends') || '');
                if (
                  !from ||
                  !to ||
                  !Number.isFinite(Date.parse(from)) ||
                  !Number.isFinite(Date.parse(to))
                ) {
                  setError('Choose valid start and end times.');
                  return;
                }
                void save(selected, new Date(from).toISOString(), new Date(to).toISOString(), true);
              }}
            >
              <label>
                Starts
                <input
                  name="starts"
                  type="datetime-local"
                  required
                  value={start}
                  disabled={!canEdit(selected) || saving}
                  onChange={(e) => setStart(e.target.value)}
                />
              </label>
              <label>
                Ends
                <input
                  name="ends"
                  type="datetime-local"
                  required
                  value={end}
                  disabled={!canEdit(selected) || saving}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </label>
              <div className="schedule-next">
                <span className="eyebrow">NEXT ACTION</span>
                <p>{selected.nextAction || 'Agree on the next step in the task discussion.'}</p>
                {selected.blocker && (
                  <p className="schedule-blocker">Blocked: {selected.blocker}</p>
                )}
              </div>
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <button
                type="button"
                className="inline-link"
                onClick={() => {
                  setSelectedId('');
                  openThread(selected);
                }}
              >
                Open discussion & handoff <ArrowUpRight size={13} />
              </button>
              <div className="dialog-footer">
                {canEdit(selected) && (
                  <>
                    {selected.scheduledStart && (
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={saving}
                        onClick={() => void save(selected, null, null, true)}
                      >
                        Unscheduled
                      </button>
                    )}
                    <button className="primary-button" disabled={saving}>
                      {saving ? 'Saving…' : 'Save schedule'}
                      <Check size={14} />
                    </button>
                  </>
                )}
              </div>
            </form>
          </>
        )}
      </dialog>
      {notice && (
        <div className="workspace-toast" role="status">
          <Check size={14} />
          {notice}
        </div>
      )}
    </div>
  );
}
