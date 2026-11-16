/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Bucket the agent change journal into chat runs.
 *
 * A record that carries a `runId` belongs to the run that id names, and the
 * run's `runAt` (its `agent_start` time) maps it to the chat row that owns the
 * run. That is exact where the wall-clock window is not: a subagent that writes
 * after the parent's terminal `agent_end` still carries the parent's run id, so
 * its change lands in the run that started it instead of the next one.
 *
 * A record with no `runId` (a journal written before runs, or a session whose
 * first frame was a tool call) falls back to the wall-clock window — the run's
 * opening row's start to its owner row's end (`runWindowMs`).
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

  // Run id → the footer that owns it, from the run's start time.
  const runStart = new Map<string, number>();
  for (const record of sorted) {
    if (record.runId && record.runAt !== undefined && !runStart.has(record.runId)) {
      runStart.set(record.runId, record.runAt);
    }
  }
  const ownerByRun = new Map<string, number>();
  for (const [runId, at] of runStart) {
    const owner = ownerForRunAt(messages, footers, at);
    if (owner !== null) ownerByRun.set(runId, owner);
  }

  const byOwnerRecords = new Map<number, SessionChangeRecord[]>();
  for (const record of sorted) {
    const owner = record.runId ? ownerByRun.get(record.runId) : undefined;
    if (owner !== undefined) {
      push(byOwnerRecords, owner, record);
      continue;
    }
    // Fallback: the wall-clock window (old journals, or a run with no footer).
    for (const slot of footers) {
      if (!slot) continue;
      const window = runWindowMs(messages, slot.runStartIndex, slot.ownerIndex);
      if (!window) continue;
      if (record.at >= window.start && record.at <= window.end) {
        push(byOwnerRecords, slot.ownerIndex, record);
        break;
      }
    }
  }

  for (const [owner, list] of byOwnerRecords) {
    const files = filesForRecords(list);
    if (files.length > 0) byOwner.set(owner, files);
  }
  return byOwner;
}

/**
 * The footer whose run contains `at`, or the nearest one after it.
 *
 * `agent_start` lands ~120 ms BEFORE the user message that opens the run's
 * window, so containment alone misses the first run; the nearest start at or
 * after `at` is that run. A late subagent change is after every window, so the
 * nearest start before it is the run it belongs to.
 */
function ownerForRunAt(
  messages: ChatMessageData[],
  footers: (RunFooterSlot | null)[],
  at: number,
): number | null {
  let next: { owner: number; start: number } | null = null;
  let previous: { owner: number; start: number } | null = null;
  for (const slot of footers) {
    if (!slot) continue;
    const window = runWindowMs(messages, slot.runStartIndex, slot.ownerIndex);
    if (!window) continue;
    if (at >= window.start && at <= window.end) return slot.ownerIndex;
    if (window.start >= at && (!next || window.start < next.start)) {
      next = { owner: slot.ownerIndex, start: window.start };
    }
    if (window.start <= at && (!previous || window.start > previous.start)) {
      previous = { owner: slot.ownerIndex, start: window.start };
    }
  }
  return next?.owner ?? previous?.owner ?? null;
}

function push(
  map: Map<number, SessionChangeRecord[]>,
  owner: number,
  record: SessionChangeRecord,
): void {
  const list = map.get(owner);
  if (list) list.push(record);
  else map.set(owner, [record]);
}

/** The net change of one run's records, one entry per path. */
function filesForRecords(records: SessionChangeRecord[]): ChangedFile[] {
  const byPath = new Map<string, PathSpan>();
  for (const record of records) {
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
  files.sort((a, b) => a.displayPath.localeCompare(b.displayPath));
  return files;
}
