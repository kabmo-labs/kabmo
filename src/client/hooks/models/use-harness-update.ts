/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Starting harness updates, and following every background run they became.
 *
 * The POST used to hold the request open for the whole install; now it answers
 * `202` and each run continues in a detached worker. So the dialog's job has two
 * halves: start it, then poll `GET /api/harness/update/status` until the record
 * says it finished — and, on open, ADOPT whatever is already in flight. That
 * second half is what makes the update really background: closing About, or
 * reloading the page, does not lose the button's state, and a reopened card
 * shows the spinner for the run that is still installing.
 *
 * **ONE loop for EVERY run, because two presses are two records.** A second
 * harness is accepted while the first installs: its record carries `queuedAt`
 * and the server's queue starts it when the run ahead settles, so the card has
 * to follow a run it did not start AND one that has not started yet. A finished
 * run is reported once per harness, and a record that was already finished when
 * the card opened is HISTORY — a reopened dialog must not re-toast last week's
 * install.
 *
 * The rows are re-read once a run settles (`invalidateHarnessVersions`): the
 * update forgot the cached probe, so the next read is the first honest one.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { invalidateHarnessVersions } from '@/client/hooks/models/use-harness-versions';
import {
  isHarnessUpdateJob,
  jobMoving,
  jobUnfinished,
  updateJobsFrom,
} from '@/shared/lib/harness/update-job';
import type { HarnessUpdateJob } from '@/shared/types/harness-update';

/** One poll per second: the worker flushes at 400ms, and this is a dialog. */
export const HARNESS_UPDATE_POLL_MS = 1_000;

/**
 * Stop polling after this long and hand the control back.
 *
 * The install itself is bounded per step by the worker; this only stops an open
 * dialog from asking forever if the server stopped answering. The run is not
 * cancelled — closing the dialog never cancels anything, and a queued run is
 * started by the server's own ticker.
 */
const MAX_FOLLOW_MS = 45 * 60_000;

/** How the hook behaves, for the two callers that need to differ from the
 *  default: the dialog passes its own open state, and a test its own cadence. */
export interface HarnessUpdateOptions {
  /** The poll cadence. One second suits a dialog. */
  pollMs?: number;
  /** Is the surface that owns this hook on screen? While it is not, no status is
   *  read and no run is followed — a run already in flight is ADOPTED on the
   *  next open, which is what "background" means here. */
  enabled?: boolean;
}

export interface HarnessUpdateController {
  /**
   * The last known record per harness — waiting, installing, or the last run
   * that finished.
   *
   * The rows render from this: `jobQueued`/`jobRunning`/`runningStepOf` answer
   * what to draw, and the log dialog renders the record's own steps and output.
   * A settled run is NOT cleared, because the interesting moment to read the log
   * is often after it failed.
   */
  jobs: HarnessUpdateJob[];
  /** Start an update; resolves to a refusal, or null when the run was started
   *  (immediately or queued behind the one already installing). */
  start: (id: string) => Promise<string | null>;
  /** Drop a settled record (the result is read and has nothing left to say);
   *  resolves to the refusal, or null when the record was deleted. */
  dismiss: (id: string) => Promise<string | null>;
}

type Settled = (message: string, ok: boolean) => void;

/** One run's identity: a new update for the same harness replaces the record. */
const runKey = (job: HarnessUpdateJob): string => `${job.harness}:${job.startedAt}`;

export function useHarnessUpdate(
  onSettled: Settled,
  { pollMs = HARNESS_UPDATE_POLL_MS, enabled = true }: HarnessUpdateOptions = {},
): HarnessUpdateController {
  const [jobs, setJobs] = useState<HarnessUpdateJob[]>([]);
  const alive = useRef(true);
  const polling = useRef(false);
  // Which harnesses this card WATCHED install. A run it only saw as history is
  // not one to toast about, and the same harness must not be reported twice.
  const watched = useRef(new Set<string>());
  const reported = useRef(new Set<string>());
  // Runs whose post-install probe answer has already been reflected in the rows.
  const probed = useRef(new Set<string>());
  // The runs this card dismissed, keyed by `harness:startedAt`. A poll already
  // in flight when the delete landed would otherwise paint the record back for
  // one frame; the key, not the harness, stays out so a NEW run is shown.
  const dismissed = useRef(new Set<string>());
  // The jobs as last rendered, so `dismiss` can name the run it is dropping
  // without waiting for a render.
  const shown = useRef<HarnessUpdateJob[]>([]);
  // The callback is read through a ref so an inline arrow from the caller does
  // not restart the mount effect (and re-adopt the records) on every render.
  const settled = useRef(onSettled);
  settled.current = onSettled;

  /** Fold one harness's record into the list, keeping the newer one. */
  const merge = useCallback((incoming: HarnessUpdateJob | null) => {
    if (!incoming) return;
    const index = shown.current.findIndex((job) => job.harness === incoming.harness);
    const next = index < 0
      ? [...shown.current, incoming]
      : shown.current.map((job) => (job.harness === incoming.harness ? incoming : job));
    shown.current = next;
    setJobs(next);
  }, []);

  /**
   * Report the runs that went from unfinished to finished, and re-read the rows
   * once each run's post-install PROBE answers.
   *
   * The probe is what stops the row quoting the version the update replaced, and
   * it lands AFTER the run settles — so the settle report and the version refresh
   * are two separate moments, not one.
   */
  const observe = useCallback((incoming: HarnessUpdateJob[]) => {
    // A poll that was already in flight when a dismissal deleted the record
    // still carries it; a dismissed run must not be painted back.
    const visible = incoming.filter((job) => !dismissed.current.has(runKey(job)));
    shown.current = visible;
    setJobs(visible);
    for (const job of visible) {
      if (jobUnfinished(job)) {
        watched.current.add(job.harness);
        reported.current.delete(job.harness);
        continue;
      }
      if (watched.current.has(job.harness) && !reported.current.has(job.harness)) {
        reported.current.add(job.harness);
        invalidateHarnessVersions();
        settled.current(job.message ?? (job.ok ? 'Update finished' : 'Update failed'), Boolean(job.ok));
      }
      // A run whose probe settled: the numbers the row reads are now the new
      // ones, so the cached rows must be dropped. `startedAt` identifies the run,
      // because the next update replaces the record under the same harness.
      if (job.probe === 'done') {
        const key = `${job.harness}:${job.startedAt}`;
        if (!probed.current.has(key)) {
          probed.current.add(key);
          invalidateHarnessVersions();
        }
      }
    }
  }, []);

  /**
   * Follow every unfinished record until they all settle.
   *
   * One loop, not one per harness: a queued run and an installing run are two
   * rows of the same poll, and a loop per press would double the reads for no
   * extra answer. `polling` keeps a second caller (the mount effect and a press
   * landing together) from starting a second loop.
   */
  const follow = useCallback(async (): Promise<void> => {
    if (polling.current) return;
    polling.current = true;
    const startedAt = Date.now();
    try {
      while (alive.current) {
        let next: HarnessUpdateJob[] | null = null;
        try {
          const response = await fetch('/api/harness/update/status', { cache: 'no-store' });
          if (!response.ok) throw new Error(String(response.status));
          next = updateJobsFrom(await response.json());
        } catch {
          // A transient failure is not the update failing: the records live on
          // disk and the next poll reads them.
        }

        if (!alive.current) return;
        if (next) observe(next);
        // Nothing left to watch — a queued run keeps this loop alive (the
        // server starts it when the install ahead finishes), and so does a run
        // whose post-install probe has not answered yet.
        if (!next || !next.some(jobMoving)) return;
        if (Date.now() - startedAt > MAX_FOLLOW_MS) return;
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, pollMs);
        await promise;
      }
    } finally {
      polling.current = false;
    }
  }, [observe, pollMs]);

  // Adopt whatever is already going: another tab, a run accepted before a
  // reload, or a queued one. A closed card has nothing to show and nothing to
  // poll for; the workers and the queue keep going either way.
  useEffect(() => {
    if (!enabled) {
      alive.current = false;
      return;
    }
    alive.current = true;
    void follow();
    return () => {
      alive.current = false;
    };
  }, [follow, enabled]);

  const start = useCallback(async (id: string): Promise<string | null> => {
    let response: Response;
    try {
      response = await fetch('/api/harness/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ harness: id }),
      });
    } catch (cause) {
      return cause instanceof Error ? cause.message : 'Update failed';
    }

    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
      success?: boolean;
      started?: boolean;
      queued?: boolean;
      job?: unknown;
    };

    // The POST's own record is trusted only if it IS a record; a payload that
    // fails the guard still means "started", just without a step to name.
    const posted = isHarnessUpdateJob(payload.job) ? payload.job : null;

    if (response.status === 202 && payload.started) {
      // `started` covers both halves: installing now, or waiting its turn.
      watched.current.add(id);
      reported.current.delete(id);
      merge(posted);
      void follow();
      return null;
    }
    if (!response.ok) {
      // A refusal carries the record that caused it (`job`), so the reader can
      // open ITS log instead of only being told to wait.
      if (posted) merge(posted);
      return payload.error ?? `Update failed (HTTP ${response.status})`;
    }
    if (payload.success) {
      // Nothing to move: the row is already current, so there is no job to
      // follow. Re-read it anyway — the previous run may have moved it.
      invalidateHarnessVersions();
      settled.current(payload.message ?? 'Update finished', true);
      return null;
    }
    return payload.error ?? 'Update failed';
  }, [follow, merge]);

  const dismiss = useCallback(async (id: string): Promise<string | null> => {
    let response: Response;
    try {
      response = await fetch('/api/harness/update/status', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ harness: id }),
      });
    } catch (cause) {
      return cause instanceof Error ? cause.message : 'Could not dismiss the update result';
    }
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) return payload.error ?? `Could not dismiss the update result (HTTP ${response.status})`;
    // Remember the RUN, not the harness: the record is gone on disk, and this
    // keeps a poll that predates the delete from painting it back.
    const target = shown.current.find((job) => job.harness === id);
    if (target) dismissed.current.add(runKey(target));
    const next = shown.current.filter((job) => job.harness !== id);
    shown.current = next;
    setJobs(next);
    return null;
  }, []);

  return { jobs, start, dismiss };
}
