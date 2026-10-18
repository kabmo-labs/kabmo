/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The settings sidebar's "Restart OMPChamber" action.
 *
 * A restart replaces the process serving this page, so the sequence is the
 * same one `POST /api/updates/apply` uses for its armed restart: read the
 * serving process's identity FIRST, ask the server to arm a detached
 * `ompchamber restart --port <port>`, then wait for a process with a different
 * `pid`/`startedAt` to answer `/api/health` and only then reload the page.
 *
 * Reloading on the response instead would fetch the dying process's bundle
 * back; never reloading would leave every stream on this page pointed at a
 * socket whose server is gone. Identity, not a timer, is what "the replacement
 * is up" means — the same rule `restart.ts` documents.
 *
 * A refusal (an instance the CLI does not own, an unidentifiable process, a
 * missing CLI) comes back with `restarting: false` and the server's own
 * sentence, which is the only place the user learns why.
 */

import { useCallback, useState } from 'preact/hooks';
import {
  readServerIdentity,
  waitForServerRestart,
  RESTART_WAIT_TIMEOUT_MS,
  type RestartWatchDeps,
} from '@/client/hooks/ui/updates/restart';

/** What one restart attempt did, in the words the caller's toast needs. */
export interface RestartChamberOutcome {
  ok: boolean;
  message: string;
}

export interface UseRestartChamberResult {
  isRestarting: boolean;
  restart: () => Promise<RestartChamberOutcome>;
}

export interface UseRestartChamberOptions {
  /**
   * Clock/network seam for the restart watch. Injected because the cases that
   * matter — a replacement that never comes up, a refusal — cannot be produced
   * on demand by a live server.
   */
  restart?: RestartWatchDeps;
}

interface RestartPayload {
  success?: boolean;
  restarting?: boolean;
  message?: string;
  error?: string;
}

export function useRestartChamber(options: UseRestartChamberOptions = {}): UseRestartChamberResult {
  const { restart: restartDeps } = options;
  const [isRestarting, setIsRestarting] = useState(false);

  const restart = useCallback(async (): Promise<RestartChamberOutcome> => {
    setIsRestarting(true);
    try {
      // Read before the request: the baseline has to come from the process
      // that is still the one answering.
      const before = await readServerIdentity(restartDeps);

      const response = await fetch('/api/chamber/restart', { method: 'POST' });
      const payload = (await response.json().catch(() => null)) as RestartPayload | null;
      if (!response.ok || !payload?.success) {
        return { ok: false, message: payload?.error ?? `Restart failed (HTTP ${response.status})` };
      }
      if (!payload.restarting) {
        // A refusal, not a failure of the request: the server explains which
        // instance it declined to replace.
        return { ok: false, message: payload.message ?? 'This instance cannot be restarted from the console.' };
      }

      const outcome = await waitForServerRestart(before, restartDeps);
      if (outcome === 'restarted') {
        window.location.reload();
        return { ok: true, message: payload.message ?? 'Restarting — this page reloads on its own.' };
      }
      if (outcome === 'timeout') {
        const seconds = Math.round((restartDeps?.timeoutMs ?? RESTART_WAIT_TIMEOUT_MS) / 1000);
        return {
          ok: false,
          message: `The server did not come back within ${seconds} seconds — reload this page once it is up.`,
        };
      }
      return { ok: false, message: 'The restart was cancelled.' };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Failed to restart OMPChamber.' };
    } finally {
      setIsRestarting(false);
    }
  }, [restartDeps]);

  return { isRestarting, restart };
}
