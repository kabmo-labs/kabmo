/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The retry an ACP agent's OWN "busy" refusal needs.
 *
 * `-32003 session_busy` is not a failed turn: the agent still considers the
 * previous prompt open (omp answers it when a cancel has not settled yet, and an
 * agent that just answered a steer can be busy for a moment). Treating it as an
 * error is what made "Stop, then send again" fail with a message the operator
 * could only work around by waiting. bb waits for the agent to go quiet and
 * retries three times; this is that rule, with the wait injectable so a test
 * does not spend seconds asleep.
 */

import { AcpRequestError } from '@kabmo-labs/kabmo-acp-mapper/calls';

export const SESSION_BUSY_CODE = -32003;
export const SESSION_BUSY_MAX_RETRIES = 3;
export const SESSION_BUSY_WAIT_MS = 2_000;

/** Whether the agent refused because it is still processing. */
export function isSessionBusy(error: unknown): boolean {
  if (!(error instanceof AcpRequestError) || error.code !== SESSION_BUSY_CODE) return false;
  const data = error.data;
  if (data && typeof data === 'object' && 'reason' in data) {
    return data.reason === 'session_busy';
  }
  return /session[ _]?busy/i.test(error.message);
}

export interface BusyRetryOptions {
  /** Give up after this many retries (the first attempt is not a retry). */
  retries?: number;
  /** Quiet window between attempts. */
  waitMs?: number;
  /** Stop retrying once the turn was cancelled or the session died. */
  isActive: () => boolean;
}

/** Dispatch one prompt, retrying the agent's `session_busy` answer. */
export async function promptWithBusyRetry<T>(
  dispatch: () => Promise<T>,
  options: BusyRetryOptions,
): Promise<T> {
  const retries = options.retries ?? SESSION_BUSY_MAX_RETRIES;
  let attempt = 0;
  for (;;) {
    try {
      return await dispatch();
    } catch (error) {
      if (!isSessionBusy(error) || attempt >= retries || !options.isActive()) throw error;
      attempt += 1;
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, options.waitMs ?? SESSION_BUSY_WAIT_MS);
      await promise;
    }
  }
}
