/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Wait out opencode's plugin activation before asking it for a session.
 *
 * opencode 2.x boots "Location plugins" per directory asynchronously and guards
 * every request that needs them with a HARD five-second wait
 * (`Location plugins did not finish activating` -> `ServiceUnavailableError`).
 * The activation itself is unbounded: measured 2.2.5 on a real config, one
 * Claude-bridge plugin finished at ~30 s and the full plugin list at ~80 s, so a
 * single `session/new` answered at +6 s with `ServiceUnavailableError` and the
 * probe card read as blocked while the agent was still booting.
 *
 * Retrying the SAME process is the fix, not respawning: the activation is
 * per-process state, and a fresh agent restarts the clock. The wait is bounded
 * because a plugin that never settles must still end in a refusal, with a
 * reason the settings card can show.
 */

import type { AcpSessionNewResult } from '@/server/lib/harness/acp/protocol';
import type { HarnessId } from '@/shared/lib/harness/catalog';

/** Enough headroom over the measured 80 s, not an open-ended probe. */
export const ACTIVATION_TIMEOUT_MS = 150_000;
/** Each retry only needs to let the five-second gate expire. */
const ACTIVATION_RETRY_MS = 3_000;

/** Is this the agent's "plugins are still activating" refusal? The ACP error
 *  carries the name in `data`, which the transport folds into the message. */
export function pluginActivationPending(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('ServiceUnavailableError');
}

export interface ActivationWait {
  totalMs?: number;
  retryMs?: number;
  perAttemptMs?: number;
}

/**
 * `session/new`, retried while opencode reports pending plugin activation.
 *
 * Only opencode has this gate. Every other harness's first refusal is final —
 * retrying an `Authentication required` would hide it behind a two-minute wait.
 */
export async function newSessionAfterActivation(
  harness: HarnessId,
  cwd: string,
  newSession: (cwd: string, timeoutMs?: number) => Promise<AcpSessionNewResult>,
  wait: ActivationWait = {},
): Promise<AcpSessionNewResult> {
  const { totalMs = ACTIVATION_TIMEOUT_MS, retryMs = ACTIVATION_RETRY_MS, perAttemptMs = 120_000 } = wait;
  if (harness !== 'opencode') return newSession(cwd, perAttemptMs);

  const giveUpAt = Date.now() + totalMs;
  for (;;) {
    try {
      return await newSession(cwd, perAttemptMs);
    } catch (error) {
      if (!pluginActivationPending(error)) throw error;
      if (Date.now() >= giveUpAt) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`${reason} (plugin activation did not finish within ${Math.round(totalMs / 1000)}s)`);
      }
      await Bun.sleep(retryMs);
    }
  }
}
