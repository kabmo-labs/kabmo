/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The client→agent calls that are waiting for an answer.
 *
 * Split out of `AcpProcess` because a request that is never answered is its own
 * subject — it is the difference between a Stop that works and one that does
 * not:
 *
 *  - a `session/prompt` runs for minutes, so its timer is disabled entirely;
 *  - `session/cancel` is a notification, so an agent may end a turn and never
 *    answer the prompt it was given, and `abandonPrompt` settles that call
 *    locally instead of leaving it open for the life of the process.
 */

import type { AcpId, AcpResponse } from '@/server/lib/harness/acp/protocol';

export interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer?: NodeJS.Timeout;
  /** What was asked, so `abandonPrompt` can find the one prompt a session has
   *  open without guessing an id. */
  method: string;
  params: Record<string, unknown>;
}

export class PendingCalls {
  private readonly map = new Map<AcpId, Pending>();

  /** Track one call. `budgetMs` of 0 means "no timer" — a whole turn. */
  begin<T>(id: AcpId, method: string, params: unknown, budgetMs: number): Promise<T> {
    const { promise, resolve, reject } = Promise.withResolvers<T>();
    const entry: Pending = {
      resolve: resolve as (value: unknown) => void,
      reject,
      method,
      params: (params ?? {}) as Record<string, unknown>,
    };
    if (budgetMs > 0) {
      entry.timer = setTimeout(() => {
        if (this.map.get(id) !== entry) return;
        this.map.delete(id);
        reject(new Error(`ACP ${method} timed out after ${budgetMs}ms`));
      }, budgetMs);
      entry.timer.unref?.();
    }
    this.map.set(id, entry);
    return promise;
  }

  /** Answer an incoming frame. False when nobody is waiting on that id, which is
   *  the normal fate of a reply to a call that was abandoned. */
  settle(response: AcpResponse): boolean {
    const entry = this.map.get(response.id);
    if (!entry) return false;
    this.map.delete(response.id);
    clearTimeout(entry.timer);
    if (response.error) {
      entry.reject(new Error(
        `${response.error.message}${response.error.data ? `: ${JSON.stringify(response.error.data)}` : ''}`,
      ));
      return true;
    }
    entry.resolve(response.result);
    return true;
  }

  /**
   * Settle a session's open `session/prompt`, as cancelled.
   *
   * The ACP spec asks the agent to answer a cancelled prompt with
   * `stopReason: "cancelled"`, and omp does not always: the request stayed open
   * for the life of the process, so every later turn — chained behind it — was
   * refused as "already processing".
   */
  abandonPrompt(sessionId: string): void {
    for (const [id, entry] of this.map) {
      if (entry.method !== 'session/prompt') continue;
      if (String(entry.params.sessionId ?? '') !== sessionId) continue;
      this.map.delete(id);
      clearTimeout(entry.timer);
      entry.resolve({ stopReason: 'cancelled' });
    }
  }

  rejectAll(error: Error): void {
    for (const [id, entry] of this.map) {
      this.map.delete(id);
      clearTimeout(entry.timer);
      entry.reject(error);
    }
  }
}
