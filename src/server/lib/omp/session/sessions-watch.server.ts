/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Watch omp's sessions directory and announce structural change to the sidebar.
 *
 * A session FILE appearing is what makes a session visible in the sidebar, and
 * omp writes it only when the first assistant message settles (~17s on a plain
 * prompt, because its writes are buffered). Nothing else reports that moment:
 * Kabmo's own writes cover spawn adoption, rename and delete, but the
 * file itself is omp's.
 *
 * The 30s idle poll this replaces existed for exactly this case, plus changes
 * made by another tab or a CLI-driven session. Both are covered here and by the
 * writes that go through Kabmo, so the poll is gone.
 *
 * Two rules keep it cheap and correct:
 *
 *   - **One watcher, recursive, on the sessions root.** Its subdirectories are
 *     per-cwd, created as sessions appear; a per-directory watcher set would
 *     have to be re-synced on every mkdir.
 *   - **A burst collapses into one publish.** omp writes a session through
 *     several syscalls (temp file, rename, the entry), and a run's transcript
 *     grows continuously — so the filter is the FILE EXTENSION that matters
 *     (`.jsonl`, not the `.probe-*` scratch files omp leaves beside them), and
 *     the debounce is what keeps a streaming write from republishing the
 *     sidebar on every append.
 *
 * The handle is anchored on `globalThis` for the reason the database and the
 * terminal store are: `bun --hot` re-evaluates this module while the watcher
 * lives on, and a module-level binding would orphan it with no way to close it.
 */

import { watch, type FSWatcher } from 'node:fs';
import { getSessionsDir } from '@/server/lib/omp/core/paths';
import { emitRealtimeSignal } from '@/server/lib/realtime/signals.server';

/** One publish per burst. A transcript append is not a structural change. */
const SESSIONS_WATCH_DEBOUNCE_MS = 750;

interface SessionsWatchState {
  watcher: FSWatcher | null;
  timer: ReturnType<typeof setTimeout> | undefined;
}

declare global {
  // eslint-disable-next-line no-var
  var __kabmoSessionsWatch: SessionsWatchState | undefined;
}

function state(): SessionsWatchState {
  return (globalThis.__kabmoSessionsWatch ??= { watcher: null, timer: undefined });
}

/**
 * Whether an event can change what the sidebar LISTS.
 *
 * `rename` is the create/delete/atomic-write family — measured against omp
 * writing a session: it lands as `rename: .<id>.jsonl.<rand>.tmp` then
 * `rename: <id>.jsonl`, and a deletion arrives the same way. An APPEND to an
 * existing transcript arrives as `change`, which is deliberately ignored: a run
 * appends continuously, and re-running the discovery scan per append would cost
 * far more than the poll this replaces. The sidebar's ordering still catches up
 * at every turn boundary, because the status publish rides the same topic.
 */
function isStructuralSessionEvent(eventType: string, filename: string | null): boolean {
  if (eventType !== 'rename') return false;
  return typeof filename === 'string' && filename.endsWith('.jsonl');
}

/**
 * Start watching, idempotently. Called once at boot; a second call is a no-op so
 * a hot reload cannot open a duplicate watcher (which would double every
 * publish).
 *
 * A sessions directory that does not exist is NOT created: omp owns that tree,
 * and Kabmo creating it to watch it would be writing into the agent's
 * home. The watch is skipped instead, and a boot after omp has written its first
 * session picks it up.
 */
export function startSessionsWatch(): void {
  const host = state();
  if (host.watcher !== null) return;

  try {
    host.watcher = watch(getSessionsDir(), { recursive: true }, (eventType, filename) => {
      if (!isStructuralSessionEvent(eventType, filename)) return;
      // Debounced because omp's create is a temp-file rename followed by the
      // real one: both land as structural events, and one publish is enough.
      clearTimeout(host.timer);
      host.timer = setTimeout(() => emitRealtimeSignal('sidebar-structure'), SESSIONS_WATCH_DEBOUNCE_MS);
    });
    // A watcher must never hold the process open.
    host.watcher.unref?.();
  } catch {
    // A missing directory, or a platform without recursive watch. The sidebar
    // still updates on every Kabmo-side write; only a session created by an
    // external omp process would be late.
  }
}

/** Close the watcher (shutdown). */
export function stopSessionsWatch(): void {
  const host = state();
  clearTimeout(host.timer);
  host.timer = undefined;
  try {
    host.watcher?.close();
  } catch {
    // Already gone.
  }
  host.watcher = null;
}
