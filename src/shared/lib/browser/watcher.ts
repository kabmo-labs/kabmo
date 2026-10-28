/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Browser-level watcher that notices a session's new page target the moment it
 * is created, instead of waiting for the routes's slower ownership poll.
 *
 * Enabling target discovery also replays already-existing targets as
 * `Target.targetCreated` events, so a watcher that connects after the tab was
 * created still learns about it. Ownership is confirmed against the on-disk
 * registry (with short retries, since the registry write can trail the CDP
 * event by a few milliseconds) before anyone attaches to the page.
 */

import { acquireConnection, releaseConnection } from '@/shared/lib/browser/connection';
import { readString } from '@/shared/lib/browser/util';
import { isRecord } from '@/shared/lib/util/guards';

export interface TargetWatcherHandle {
  close: () => void;
}

interface TargetWatcherOptions {
  getOwnedTargetIds: () => Promise<string[]>;
  onOwnedTarget: (targetId: string) => void;
}

const OWNERSHIP_RETRIES = 8;
const OWNERSHIP_RETRY_DELAY_MS = 75;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Watch a shared browser for new page targets owned by one omp process. */
export async function watchOwnedTargets(wsUrl: string, opts: TargetWatcherOptions): Promise<TargetWatcherHandle> {
  const conn = await acquireConnection(wsUrl);
  const seen = new Set<string>();
  let closed = false;

  const confirmOwnership = async (targetId: string): Promise<void> => {
    for (let attempt = 0; attempt < OWNERSHIP_RETRIES && !closed; attempt += 1) {
      const owned = await opts.getOwnedTargetIds().catch(() => [] as string[]);
      if (owned.includes(targetId)) {
        if (!closed) opts.onOwnedTarget(targetId);
        return;
      }
      await delay(OWNERSHIP_RETRY_DELAY_MS);
    }
  };

  const unsubscribeEvents = conn.onEvent((method, params) => {
    if (closed || method !== 'Target.targetCreated' || !isRecord(params)) return;
    const info = params.targetInfo;
    if (!isRecord(info) || info.type !== 'page') return;
    const targetId = readString(info, 'targetId');
    if (!targetId || seen.has(targetId)) return;
    seen.add(targetId);
    void confirmOwnership(targetId);
  });

  const close = (): void => {
    if (closed) return;
    closed = true;
    unsubscribeEvents();
    unsubscribeClose();
    releaseConnection(wsUrl, conn);
  };
  const unsubscribeClose = conn.onClose(close);

  await conn.send('Target.setDiscoverTargets', { discover: true }).catch(() => {});
  return { close };
}
