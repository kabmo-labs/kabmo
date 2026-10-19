/**
 * Live update state: the check that reports what is available, and the apply
 * that runs it.
 *
 * The apply is a POST whose response is an SSE stream, not a JSON body. An
 * `omp update` or a Kabmo install runs for minutes; a buffered response
 * left the console with a spinner and nothing else until it finished, and
 * discarded the command output the server had already collected. Every frame
 * the stream carries is folded into `progress`, which survives the modal being
 * closed — the hook lives on the sidebar, so leaving the dialog no longer hides
 * the run.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { readSseStream } from '@/shared/lib/chat/read-sse';
import { appendUpdateLog, type UpdateLogState } from '@/shared/lib/updates/progress';
import { readServerIdentity, waitForServerRestart, RESTART_WAIT_TIMEOUT_MS, type RestartWatchDeps, type ServerIdentity } from '@/client/hooks/ui/updates/restart';
import type { UpdateApplyResult, UpdateCheckResult, UpdateTarget } from '@/shared/types/updates';

export interface UseUpdatesResult {
  info: UpdateCheckResult | null;
  checking: boolean;
  applying: UpdateTarget | null;
  /** Log of the run in flight (or the last one), null before any apply. */
  progress: UpdateLogState | null;
  error: string | null;
  hasUpdate: boolean;
  check: () => Promise<void>;
  apply: (target: UpdateTarget) => Promise<UpdateApplyResult | null>;
}

export interface UseUpdatesOptions {
  /**
   * Clock/network seam for the post-update restart watch. Injected because the
   * cases that matter — a replacement that never comes up, an abort — cannot be
   * produced on demand by a live server.
   */
  restart?: RestartWatchDeps;
}

function responseMessage(payload: unknown, fallback: string): string {
  if (typeof payload !== 'object' || payload === null) return fallback;

  if ('error' in payload && typeof payload.error === 'string') return payload.error;
  if ('message' in payload && typeof payload.message === 'string') return payload.message;
  return fallback;
}

export function isUpdateApplyResult(payload: unknown): payload is UpdateApplyResult {
  if (typeof payload !== 'object' || payload === null) return false;

  return (
    'success' in payload && typeof payload.success === 'boolean' &&
    'target' in payload && (payload.target === 'kabmo' || payload.target === 'omp') &&
    'manual' in payload && typeof payload.manual === 'boolean' &&
    'message' in payload && typeof payload.message === 'string'
  );
}

export function useUpdates(options: UseUpdatesOptions = {}): UseUpdatesResult {
  const { restart: restartDeps } = options;
  const [info, setInfo] = useState<UpdateCheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState<UpdateTarget | null>(null);
  const [progress, setProgress] = useState<UpdateLogState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlightCheckRef = useRef<Promise<void> | null>(null);
  const didAutoCheckRef = useRef(false);
  const applyAbortRef = useRef<AbortController | null>(null);

  const check = useCallback(() => {
    if (inFlightCheckRef.current) return inFlightCheckRef.current;

    const request = (async () => {
      setChecking(true);
      setError(null);

      try {
        const response = await fetch('/api/updates/check');
        const payload: unknown = await response.json();
        if (!response.ok) {
          throw new Error(responseMessage(payload, `Update check failed (HTTP ${response.status})`));
        }
        setInfo(payload as UpdateCheckResult);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Unable to check for updates.');
      } finally {
        setChecking(false);
        inFlightCheckRef.current = null;
      }
    })();

    inFlightCheckRef.current = request;
    return request;
  }, []);

  const apply = useCallback(async (target: UpdateTarget): Promise<UpdateApplyResult | null> => {
    setApplying(target);
    setProgress({ lines: [], pending: '', truncated: false });
    setError(null);

    const controller = new AbortController();
    applyAbortRef.current = controller;
    // The fold is mirrored in a local so each frame is one setState, rather
    // than a read-modify-write against the previous render's state.
    let log: UpdateLogState = { lines: [], pending: '', truncated: false };
    // A holder rather than a bare `let`: the result is assigned from inside the
    // SSE frame callback, which TypeScript's control-flow analysis cannot see,
    // so a narrowed `null` would be read back here as a value that can never be
    // set.
    const applied: { result: UpdateApplyResult | null } = { result: null };
    // Who is serving this page BEFORE the run. Only a Kabmo update can
    // replace that process, and the replacement is recognised by answering with
    // a different `pid`/`startedAt` — so the baseline has to be read while the
    // old process is still the one answering.
    let before: ServerIdentity | null = null;
    // Set when this call ends by navigating to the restarted server. The
    // spinner stays on: the page is being replaced, and a dialog that flashed
    // back to idle first would read as "finished" over a navigation still in
    // flight.
    let navigating = false;

    try {
      if (target === 'kabmo') before = await readServerIdentity(restartDeps);

      const response = await fetch('/api/updates/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ target }),
        signal: controller.signal,
      });

      if (!response.ok && !(response.headers.get('content-type') ?? '').includes('text/event-stream')) {
        const payload: unknown = await response.json().catch(() => null);
        const message = responseMessage(payload, `Update failed (HTTP ${response.status})`);
        // 409 is the server saying another run holds the slot. That is a state,
        // not a failure of this request, so it is reported by toast alone: an
        // error state would replace the update rows with a block the user
        // cannot act on, and its Retry only re-checks.
        if (response.status === 409) return { success: false, target, manual: false, message };
        throw new Error(message);
      }

      await readSseStream(
        response,
        (event, data) => {
          if (event === 'line') {
            log = appendUpdateLog(log, JSON.parse(data) as string);
            setProgress(log);
            return;
          }
          if (event === 'stage') {
            // A stage is its own line: the updater's heading and the output
            // under it must not be glued into one line.
            log = appendUpdateLog(log, `${JSON.parse(data) as string}\n`);
            setProgress(log);
            return;
          }
          if (event === 'result') {
            const payload: unknown = JSON.parse(data);
            if (isUpdateApplyResult(payload)) {
              applied.result = payload;
              // A finished run's output is not a report to come back to. An
              // update that worked said everything it had to say in its toast,
              // and an install log left standing is noise the next time the
              // dialog is opened. A run that FAILED keeps its output: the
              // reason is in those lines, and the toast carries only a summary.
              if (payload.success) setProgress(null);
            }
          }
        },
        controller.signal,
      );

      const result = applied.result;
      if (controller.signal.aborted) return result;

      // An armed restart means this page is still being served by the process
      // whose build was just replaced: re-checking would read the OLD version
      // back, and reloading right now would fetch the old bundle. So the page
      // waits for the replacement and then reloads into it — which is the whole
      // point of updating from the console, since the new build only runs after
      // a navigation.
      if (result?.restarting) {
        // Appended, not replaced: the install output is what a failed restart
        // has to be read against, and a dialog that swapped it for one line
        // would erase the only record of what ran.
        log = appendUpdateLog(log, 'Update installed — waiting for the server to restart on this port…\n');
        setProgress(log);
        const outcome = await waitForServerRestart(before, { ...restartDeps, signal: controller.signal });
        if (outcome === 'restarted') {
          // The page is going away, so the applying spinner must not be cleared
          // first: a dialog that flashed back to idle would read as "finished"
          // over a navigation the user is still waiting on.
          navigating = true;
          window.location.reload();
          return result;
        }
        // An abort is the panel going away with the run — the same null the
        // other abort path returns, so no caller toasts into a torn-down view.
        if (outcome === 'aborted') return null;
        if (outcome === 'timeout') {
          const seconds = Math.round(RESTART_WAIT_TIMEOUT_MS / 1000);
          return {
            ...result,
            restarting: false,
            message: `${result.message} The server did not come back within ${seconds} seconds — reload this page once it is up.`,
          };
        }
        return result;
      }

      await check();
      return result;
    } catch (cause) {
      if (controller.signal.aborted) return null;
      const message = cause instanceof Error ? cause.message : 'Unable to apply the update.';
      setError(message);
      // Returned rather than swallowed: the caller's toast is the only surface
      // the user sees, and a generic "could not be completed" would hide a
      // refusal the server explained — an update already running, in the case
      // that matters most, because a reload has just erased this panel's own
      // record that one was.
      return { success: false, target, manual: false, message };
    } finally {
      // A navigating call leaves `applying` set: the spinner is the only thing
      // telling the user the console is still working, and it is cleared by the
      // reload itself.
      if (!navigating && applyAbortRef.current === controller) {
        applyAbortRef.current = null;
        setApplying(null);
      }
    }
  }, [check, restartDeps]);

  useEffect(() => {
    if (didAutoCheckRef.current) return;
    didAutoCheckRef.current = true;
    void check();
  }, [check]);

  useEffect(() => () => applyAbortRef.current?.abort(), []);

  return {
    info,
    checking,
    applying,
    progress,
    error,
    hasUpdate: Boolean(info?.kabmo.updateAvailable || info?.omp.updateAvailable),
    check,
    apply,
  };
}
