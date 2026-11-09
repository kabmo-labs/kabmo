/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Starting a harness update, and following the background job it becomes.
 *
 * The POST used to hold the request open for the whole install; now it answers
 * `202` and the run continues in a detached worker. So the dialog's job has two
 * halves: start it, then poll `GET /api/harness/update/status` until the record
 * says it finished — and, on open, ADOPT a run that is already in flight. That
 * second half is what makes the update really background: closing About, or
 * reloading the page, does not lose the button's state, and a reopened card
 * shows the spinner for the run that is still installing.
 *
 * The rows are re-read once the run settles (`invalidateHarnessVersions`): the
 * update forgot the cached probe, so the next read is the first honest one.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { invalidateHarnessVersions } from '@/client/hooks/models/use-harness-versions';
import { isHarnessUpdateJob, updateJobFrom } from '@/shared/lib/harness/update-job';
import type { HarnessUpdateJob } from '@/shared/types/harness-update';

/** One poll per second: the worker flushes at 400ms, and this is a dialog. */
export const HARNESS_UPDATE_POLL_MS = 1_000;

/**
 * Stop polling after this long and hand the control back.
 *
 * The install itself is bounded per step by the worker; this only stops an
 * open dialog from asking forever if the record stopped moving. The run is not
 * cancelled — closing the dialog never cancels anything.
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
  /** The harness whose run this dialog is following, or null. */
  updating: string | null;
  /** The step the worker is on (`adapter`, `Claude Code`, …), when it says. */
  progress: string | null;
  /**
   * The record itself — the last one read, running or finished.
   *
   * The log dialog renders from this: the worker streams every command's output
   * into it, so the panel is the install's own console. It is NOT cleared when a
   * run settles, because the interesting moment to read the log is often after
   * it failed.
   */
  job: HarnessUpdateJob | null;
  /** Start an update; resolves to a refusal, or null when the run was started
   *  (or there was nothing to move). */
  start: (id: string) => Promise<string | null>;
}

type Settled = (message: string, ok: boolean) => void;

function runningStep(job: HarnessUpdateJob | null): string | null {
  const steps = job && Array.isArray(job.steps) ? job.steps : [];
  return steps.find((step) => step.state === 'running')?.part ?? null;
}

export function useHarnessUpdate(
  onSettled: Settled,
  { pollMs = HARNESS_UPDATE_POLL_MS, enabled = true }: HarnessUpdateOptions = {},
): HarnessUpdateController {
  const [updating, setUpdating] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [job, setJob] = useState<HarnessUpdateJob | null>(null);
  const alive = useRef(true);
  // The callback is read through a ref so an inline arrow from the caller does
  // not restart the mount effect (and re-adopt the job) on every render.
  const settled = useRef(onSettled);
  settled.current = onSettled;

  const follow = useCallback(async (id: string): Promise<void> => {
    const startedAt = Date.now();
    while (alive.current) {
      let job: HarnessUpdateJob | null = null;
      try {
        const response = await fetch('/api/harness/update/status', { cache: 'no-store' });
        if (!response.ok) throw new Error(String(response.status));
        job = updateJobFrom(await response.json());
      } catch {
        // A transient failure is not the update failing: the record lives on
        // disk and the next poll reads it.
      }

      if (!alive.current) return;
      // Kept even once it finishes: the log stays readable while the panel is
      // open, and a failure is the case a reader wants the output for.
      if (job) setJob(job);
      if (job?.finishedAt != null) {
        setUpdating(null);
        setProgress(null);
        invalidateHarnessVersions();
        settled.current(job.message ?? (job.ok ? 'Update finished' : 'Update failed'), Boolean(job.ok));
        return;
      }
      if (job?.harness === id) setProgress(runningStep(job));

      if (Date.now() - startedAt > MAX_FOLLOW_MS) {
        setUpdating(null);
        setProgress(null);
        return;
      }
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, pollMs);
      await promise;
    }
  }, [pollMs]);

  // Adopt a run that is already going: another tab, or this dialog reopened.
  useEffect(() => {
    // A closed card has nothing to show and nothing to poll for; the run keeps
    // going in its worker either way.
    if (!enabled) {
      alive.current = false;
      return;
    }
    alive.current = true;
    void (async () => {
      try {
        const response = await fetch('/api/harness/update/status', { cache: 'no-store' });
        if (!response.ok) return;
        const running = updateJobFrom(await response.json());
        if (!alive.current || !running) return;
        setJob(running);
        if (running.finishedAt !== null) return;
        setUpdating(running.harness);
        setProgress(runningStep(running));
        void follow(running.harness);
      } catch {
        // Nothing running, or no server to ask: the list still renders.
      }
    })();
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
      job?: HarnessUpdateJob;
    };

    // The POST's own record is trusted only if it IS a record; a payload that
    // fails the guard still means "started", just without a step to name.
    const posted = isHarnessUpdateJob(payload.job) ? payload.job : null;

    if (response.status === 202 && payload.started) {
      setUpdating(id);
      setJob(posted);
      setProgress(runningStep(posted));
      void follow(id);
      return null;
    }
    if (!response.ok) {
      // A refusal carries the run that caused it: the reader can open ITS log
      // instead of only being told to wait.
      if (response.status === 409 && posted) setJob(posted);
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
  }, [follow]);

  return { updating, progress, job, start };
}
