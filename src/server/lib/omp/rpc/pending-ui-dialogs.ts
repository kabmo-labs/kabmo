/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Ask/approval dialogs an omp process is currently BLOCKED on.
 *
 * Every `extension_ui_request` with an answerable method (`select`, `confirm`,
 * `input`, `editor`) parks its tool call until the matching
 * `extension_ui_response` arrives, and omp never re-delivers the frame. A
 * browser that reloads mid-dialog therefore has no way to learn the request id
 * it must answer: the modal disappears, the agent stays blocked, and the run
 * looks hung until the user stops it. Remembering the requests here — on the
 * server, which outlives the client — lets a reattaching client replay them.
 *
 * Split from the session wrapper so rpc-manager.ts stays under the repo's
 * per-file size ceiling.
 */

import { ANSWERABLE_UI_METHODS } from '@/server/lib/omp/rpc/constants';
import type { RpcFrame } from '@/server/lib/omp/rpc/process';

export class PendingUiDialogs {
  // Insertion order is omp's arrival order, which is the order the user should
  // answer them in — a Map preserves it.
  private readonly requests = new Map<string, RpcFrame>();

  /** Record an answerable request, or forget one omp withdrew (`cancel`).
   *  Returns whether the pending set changed — a caller that republishes state
   *  on every frame would otherwise republish for `notify`/`open_url` too. */
  track(frame: RpcFrame): boolean {
    if (frame.method === 'cancel') {
      const targetId = typeof frame.targetId === 'string' ? frame.targetId : '';
      return targetId ? this.requests.delete(targetId) : false;
    }
    const id = typeof frame.id === 'string' ? frame.id : '';
    if (!id || typeof frame.method !== 'string' || ANSWERABLE_UI_METHODS[frame.method] !== true) return false;
    // A repeat of the same id is not a change.
    if (this.requests.has(id)) return false;
    this.requests.set(id, frame);
    return true;
  }

  /** Forget a request once its response is on the wire — omp will not raise it
   *  again, so replaying it to a later client would only show a dead modal. */
  resolve(id: string): boolean {
    return this.requests.delete(id);
  }

  /** Still-blocking requests, oldest first. */
  list(): RpcFrame[] {
    return [...this.requests.values()];
  }

  clear(): void {
    this.requests.clear();
  }
}
