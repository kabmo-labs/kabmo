/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Bucket the agent change journal into chat runs.
 *
 * The journal records epoch-ms write times and nothing that names a message, so
 * a write belongs to the run whose wall-clock window contains it. A run's
 * window is its opening row's start to its owner row's end (`runWindowMs`).
 *
 * One file can be written several times in a run; the list shows the NET change
 * — the first record's `before` to the last record's `after` — because that is
 * what the run did to the file. A file created and deleted in the same run, or
 * written back to the same blob, is not a change and is dropped.
 */

import type { ChangedFile, ChatMessageData, SessionChangeRecord } from '@/shared/types';
import type { RunFooterSlot } from '@/shared/lib/chat/timeline/run-footer';
import { runWindowMs } from '@/shared/lib/chat/duration';

/** One file's first and last write inside a run. */
interface PathSpan {
  first: SessionChangeRecord;
  last: SessionChangeRecord;
}

/**
 * `ownerIndex → files` for every run that changed something. Runs with no
 * journal records are absent, so a caller renders nothing for them.
 */
export function bucketChangesByRun(
  messages: ChatMessageData[],
  footers: (RunFooterSlot | null)[],
  records: readonly SessionChangeRecord[],
): Map<number, ChangedFile[]> {
  const byOwner = new Map<number, ChangedFile[]>();
  if (records.length === 0) return byOwner;
  const sorted = [...records].sort((a, b) => a.at - b.at);

  for (const slot of footers) {
    if (!slot) continue;
    const window = runWindowMs(messages, slot.runStartIndex, slot.ownerIndex);
    if (!window) continue;
    const inWindow = sorted.filter((record) => record.at >= window.start && record.at <= window.end);
    if (inWindow.length === 0) continue;

    const byPath = new Map<string, PathSpan>();
    for (const record of inWindow) {
      const span = byPath.get(record.path);
      if (span) span.last = record;
      else byPath.set(record.path, { first: record, last: record });
    }

    const files: ChangedFile[] = [];
    for (const [path, { first, last }] of byPath) {
      // Created and deleted in the same run: no net change.
      if (first.before === null && last.after === null) continue;
      // Written back to the same content: no net change. Only a real blob key
      // can prove that; `undefined` means "not stored", not "unchanged".
      if (typeof first.before === 'string' && first.before === last.after) continue;
      const status = first.before === null ? 'added' : last.after === null ? 'deleted' : 'modified';
      files.push({ path, displayPath: last.displayPath, status, agent: last.agent });
    }
    if (files.length === 0) continue;
    files.sort((a, b) => a.displayPath.localeCompare(b.displayPath));
    byOwner.set(slot.ownerIndex, files);
  }
  return byOwner;
}
