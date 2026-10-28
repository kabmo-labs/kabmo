/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The scheduled-task list: one row per task with its schedule, its next fire
 * and the state of its last run, plus run-now / pause / edit / delete.
 *
 * The next-fire line is rendered from the server's own `nextRunAt`, never from
 * a client-side recomputation — the runtime advances that clock, and a locally
 * derived one would disagree with it the moment a fire happened in another tab.
 * A task whose clock is null is either paused or spent, and those are DIFFERENT
 * states that read as different rows: "Paused" versus "Ran once — no next run".
 */

import { useEffect, useState } from 'preact/hooks';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  RotateCw,
  Trash2,
} from 'lucide-preact';
import { describeSchedule } from '@/shared/lib/schedule/parse';
import type { ScheduledTask, ScheduledTaskRun } from '@/shared/types/schedule';

interface TaskListProps {
  tasks: ScheduledTask[];
  loading: boolean;
  /** Task ids with a request in flight, so each row disables its own buttons. */
  pending: string | null;
  onRunNow: (id: string) => void;
  onToggleEnabled: (task: ScheduledTask) => void;
  onEdit: (task: ScheduledTask) => void;
  onDelete: (id: string) => void;
  loadRuns: (id: string) => Promise<ScheduledTaskRun[]>;
}

function formatAbsolute(at: number | null): string {
  return at === null ? '—' : new Date(at).toLocaleString();
}

/** A short label for the prompt when the task has no name. */
function taskLabel(task: ScheduledTask): string {
  if (task.name) return task.name;
  const text = task.prompt.replace(/\s+/g, ' ').trim();
  return text.length > 60 ? `${text.slice(0, 57)}…` : text || '(empty prompt)';
}

export function TaskList({
  tasks,
  loading,
  pending,
  onRunNow,
  onToggleEnabled,
  onEdit,
  onDelete,
  loadRuns,
}: TaskListProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [runs, setRuns] = useState<ScheduledTaskRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    let active = true;
    setRunsLoading(true);
    loadRuns(expanded).then((list) => {
      if (!active) return;
      setRuns(list);
      setRunsLoading(false);
    });
    return () => {
      active = false;
    };
  }, [expanded, loadRuns]);

  if (tasks.length === 0) {
    return (
      <div className="px-3 py-8 text-center text-[11px] text-ink/50 border border-dashed border-ink/15 rounded-lg">
        {loading ? 'Loading…' : 'No scheduled tasks yet. Create one above.'}
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {tasks.map((task) => {
        const busy = pending === task.id;
        const isExpanded = expanded === task.id;
        return (
          <li key={task.id} className="border border-ink/10 rounded-lg bg-paper">
            <div className="flex items-start gap-2 p-2.5">
              <span className="mt-0.5 shrink-0" aria-hidden="true">
                {!task.enabled ? (
                  <Pause size={14} className="text-ink/40" />
                ) : task.lastStatus === 'error' ? (
                  <AlertCircle size={14} className="text-error" />
                ) : task.lastStatus === 'success' ? (
                  <CheckCircle2 size={14} className="text-ink/60" />
                ) : (
                  <Clock size={14} className="text-ink/60" />
                )}
              </span>

              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-ink truncate">{taskLabel(task)}</p>
                <p className="text-[11px] text-ink/60 mt-0.5">
                  {describeSchedule(task.kind, task.spec)}
                  <span className="text-ink/30"> · </span>
                  {!task.enabled
                    ? task.kind === 'once' && task.lastRunAt !== null
                      ? 'Ran once — no next run'
                      : 'Paused'
                    : `Next ${formatAbsolute(task.nextRunAt)}`}
                </p>
                {task.cwd && <p className="text-[10.5px] text-ink/40 font-mono truncate mt-0.5">{task.cwd}</p>}
                {task.sessionId && (
                  <p className="text-[10.5px] text-ink/40 font-mono truncate mt-0.5">
                    resumes {task.sessionId.slice(0, 8)}
                  </p>
                )}
                {task.lastStatus === 'error' && task.lastError && (
                  <p className="text-[10.5px] text-error mt-0.5 break-words">{task.lastError}</p>
                )}
                {task.runCount > 0 && (
                  <p className="text-[10.5px] text-ink/40 mt-0.5">Fired {task.runCount}×</p>
                )}
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  title="Run now"
                  aria-label="Run now"
                  disabled={busy}
                  onClick={() => onRunNow(task.id)}
                  className="p-1.5 rounded hover:bg-ink/5 text-ink/60 hover:text-ink transition-colors disabled:opacity-40"
                >
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                </button>
                <button
                  type="button"
                  title={task.enabled ? 'Pause' : 'Resume'}
                  aria-label={task.enabled ? 'Pause' : 'Resume'}
                  aria-pressed={task.enabled}
                  disabled={busy}
                  onClick={() => onToggleEnabled(task)}
                  className="p-1.5 rounded hover:bg-ink/5 text-ink/60 hover:text-ink transition-colors disabled:opacity-40"
                >
                  <RefreshCw size={13} />
                </button>
                <button
                  type="button"
                  title="Edit"
                  aria-label="Edit"
                  disabled={busy}
                  onClick={() => onEdit(task)}
                  className="p-1.5 rounded hover:bg-ink/5 text-ink/60 hover:text-ink transition-colors disabled:opacity-40"
                >
                  <RotateCw size={13} />
                </button>
                <button
                  type="button"
                  title="Delete"
                  aria-label="Delete"
                  disabled={busy}
                  onClick={() => onDelete(task.id)}
                  className="p-1.5 rounded hover:bg-ink/5 text-ink/60 hover:text-error transition-colors disabled:opacity-40"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setExpanded(isExpanded ? null : task.id)}
              aria-expanded={isExpanded}
              className="w-full text-left px-2.5 py-1.5 border-t border-ink/5 text-[10.5px] text-ink/50 hover:text-ink transition-colors"
            >
              {isExpanded ? 'Hide run history' : 'Run history'}
            </button>

            {isExpanded && (
              <div className="px-2.5 pb-2.5 space-y-1">
                {runsLoading && <p className="text-[10.5px] text-ink/40">Loading…</p>}
                {!runsLoading && runs.length === 0 && (
                  <p className="text-[10.5px] text-ink/40">This task has not run yet.</p>
                )}
                {!runsLoading &&
                  runs.map((run) => (
                    <div key={run.id} className="flex items-start gap-2 text-[10.5px]">
                      <span className="w-16 shrink-0 text-ink/50">{new Date(run.startedAt).toLocaleTimeString()}</span>
                      <span
                        className={`w-14 shrink-0 font-medium ${
                          run.status === 'error' ? 'text-error' : run.status === 'running' ? 'text-ink/60' : 'text-ink/70'
                        }`}
                      >
                        {run.status}
                      </span>
                      <span className="min-w-0 flex-1 text-ink/60 break-words">{run.detail || '—'}</span>
                    </div>
                  ))}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
