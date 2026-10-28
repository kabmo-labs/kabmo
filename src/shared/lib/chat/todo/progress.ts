/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Display-side helpers for a todo list: the one-line progress summary, the
 * per-task visual state, and the "which task is the agent on" lookup the panel
 * highlights.
 *
 * Everything here is presentational — the parse itself lives in `snapshot.ts`.
 * The status → presentation mapping is a table rather than a chain of `if`s
 * because there are five statuses and three consumers (icon, label, class
 * list), and a missing case in any one of them is how a `blocked` task ends up
 * rendered as a plain pending one.
 */

import type { TodoItem, TodoPhase, TodoProgress, TodoStatus } from '@/shared/types/todo';

export interface TodoStatusVisual {
  /** Short label for the row's status pill. */
  label: string;
  /** Tailwind text color for the icon and label. */
  tone: string;
  /** True when the row is a live (in-progress) task — highlighted, not dimmed. */
  active: boolean;
  /** True when the task is out of the way (completed / abandoned). */
  closed: boolean;
}

const STATUS_VISUALS: Record<TodoStatus, TodoStatusVisual> = {
  pending: { label: 'Pending', tone: 'text-ink/45', active: false, closed: false },
  in_progress: { label: 'In progress', tone: 'text-ink', active: true, closed: false },
  completed: { label: 'Completed', tone: 'text-success', active: false, closed: true },
  abandoned: { label: 'Abandoned', tone: 'text-error/70', active: false, closed: true },
  blocked: { label: 'Blocked', tone: 'text-warning', active: false, closed: false },
};

export function todoStatusVisual(status: TodoStatus): TodoStatusVisual {
  return STATUS_VISUALS[status] ?? STATUS_VISUALS.pending;
}

/**
 * One-line summary of a snapshot: `4/11 done · 1 in progress · 2 blocked`.
 *
 * Counts CLOSED (completed + abandoned) against the total, matching omp's own
 * HUD counter — an abandoned task is deliberately not coming back, so leaving
 * it in the denominator is what makes a list read as permanently stuck.
 */
export function todoProgressLabel(progress: TodoProgress): string {
  if (progress.total === 0) return 'No tasks';
  const parts = [`${progress.closed}/${progress.total} done`];
  if (progress.inProgress > 0) parts.push(`${progress.inProgress} in progress`);
  if (progress.blocked > 0) parts.push(`${progress.blocked} blocked`);
  if (progress.abandoned > 0) parts.push(`${progress.abandoned} abandoned`);
  return parts.join(' · ');
}

/** Percentage of the list that is closed, rounded to a whole number. */
export function todoProgressPercent(progress: TodoProgress): number {
  if (progress.total === 0) return 0;
  return Math.round((progress.closed / progress.total) * 100);
}

/**
 * The row the panel marks as current: the in-progress task, else the first
 * pending one. Identified by phase index + task index rather than by content,
 * because two phases may legitimately hold tasks with identical text (omp
 * itself keys its own task lookup by content, and that ambiguity is its
 * problem, not one to inherit here).
 */
export function currentTaskLocation(phases: readonly TodoPhase[]): { phase: number; task: number } | null {
  for (let phase = 0; phase < phases.length; phase++) {
    const tasks = phases[phase].tasks;
    for (let task = 0; task < tasks.length; task++) {
      if (tasks[task].status === 'in_progress') return { phase, task };
    }
  }
  for (let phase = 0; phase < phases.length; phase++) {
    const tasks = phases[phase].tasks;
    for (let task = 0; task < tasks.length; task++) {
      if (tasks[task].status === 'pending') return { phase, task };
    }
  }
  return null;
}

/** Tasks of one phase that are closed, for the phase header's `n/m` badge. */
export function closedTaskCount(phase: TodoPhase): number {
  return phase.tasks.filter((task) => task.status === 'completed' || task.status === 'abandoned').length;
}

/** Blocker note of a task, trimmed, or undefined when there is nothing to show. */
export function taskNote(task: TodoItem): string | undefined {
  const note = task.blocker?.trim() || task.details?.trim();
  return note ? note : undefined;
}
