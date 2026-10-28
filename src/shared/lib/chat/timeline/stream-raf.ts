/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Coalesces bursty agent-stream writes into one React commit per animation
 * frame. A `key` keeps only the newest payload per message (omp message_update
 * frames carry FULL content); keyless entries apply in arrival order.
 */

export function createRafBatch<T>(
  apply: (updater: (prev: T) => T) => void,
  afterFlush?: () => void,
) {
  let frame: number | null = null;
  let epoch = 0;
  let pending: { key?: string; updater: (prev: T) => T }[] = [];

  const run = () => {
    frame = null;
    const batch = pending;
    pending = [];
    if (!batch.length) return;
    for (const entry of batch) apply(entry.updater);
    afterFlush?.();
  };

  const schedule = () => {
    if (frame !== null) return;
    const token = ++epoch;
    frame = requestAnimationFrame(() => {
      if (token !== epoch) return;
      run();
    });
  };

  const stopFrame = () => {
    epoch += 1;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  };
  return {
    queue(updater: (prev: T) => T, key?: string) {
      const idx = key === undefined ? -1 : pending.findIndex(e => e.key === key);
      if (idx !== -1) pending[idx] = { key, updater };
      else pending.push({ key, updater });
      schedule();
    },
    flush() {
      stopFrame();
      run();
    },
    cancel() {
      stopFrame();
      pending = [];
    },
  };
}
