/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The panel's formatting, with no Preact in it.
 *
 * Every string a reader sees for a state comes from here, so the list, the run
 * view and the header readout cannot describe the same run two ways. The MARK is
 * a text character rather than an SVG because a plugin bundle is handed only the
 * SDK and the kit — it cannot import the host's icon set — and a tick, a cross, a
 * dot and a dash are legible at 11 px without one.
 *
 * `neutral` is a dash and never a tick: a skipped job is not a pass, and painting
 * it green is the one thing a CI badge must never do.
 */

import type { RunProgress, RunState } from '../protocol';

const TONE: Readonly<Record<RunState, { mark: string; label: string; className: string }>> = {
  success: { mark: '✓', label: 'Passing', className: 'text-success-text' },
  failure: { mark: '✕', label: 'Failing', className: 'text-error-text' },
  pending: { mark: '●', label: 'Running', className: 'text-warning-text' },
  neutral: { mark: '–', label: 'Neutral', className: 'text-ink/60' },
};

export function stateMark(state: RunState): string {
  return TONE[state].mark;
}

export function stateLabel(state: RunState): string {
  return TONE[state].label;
}

export function stateClass(state: RunState): string {
  return TONE[state].className;
}

/** `14/31 jobs · 2 failing`, the honest progress line. */
export function progressLabel(progress: RunProgress): string {
  const parts = [`${progress.done}/${progress.total} jobs`];
  if (progress.failing > 0) parts.push(`${progress.failing} failing`);
  if (progress.runningStep) parts.push(progress.runningStep);
  else if (progress.running) parts.push(progress.running);
  return parts.join(' · ');
}

/** How long ago an ISO timestamp was, in the compact form a row has room for. */
export function age(iso: string | null): string {
  if (!iso) return '';
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '';
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** A job's own duration, or an empty string while it has not finished. */
export function duration(startedAt: string | null, completedAt: string | null): string {
  if (!startedAt || !completedAt) return '';
  const start = Date.parse(startedAt);
  const end = Date.parse(completedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '';
  const seconds = Math.round((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}
