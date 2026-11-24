/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Bucketing the change journal into runs. The journal has no message id, so the
 * run window is the whole contract: a write one millisecond outside it belongs
 * to another run, and a file written twice must show the NET change, not the
 * last write's pair.
 */

import { describe, expect, test } from 'bun:test';
import { bucketChangesByRun } from '@/shared/lib/chat/timeline/changed-files';
import type { RunFooterSlot } from '@/shared/lib/chat/timeline/run-footer';
import type { ChatMessageData, SessionChangeRecord } from '@/shared/types';

function message(overrides: Partial<ChatMessageData>): ChatMessageData {
  return { id: 'm', role: 'ai', content: '', ...overrides };
}

function footer(ownerIndex: number, runStartIndex: number): RunFooterSlot {
  return {
    msg: message({ id: `owner-${ownerIndex}` }),
    ownerIndex,
    durationMs: null,
    runStartIndex,
    runUserId: `user-${runStartIndex}`,
    answerText: '',
  };
}

function record(overrides: Partial<SessionChangeRecord>): SessionChangeRecord {
  return {
    at: 0,
    agent: 'Main',
    tool: 'edit',
    path: '/repo/a.ts',
    displayPath: 'a.ts',
    before: 'b1',
    after: 'b2',
    ...overrides,
  };
}

describe('bucketChangesByRun', () => {
  const messages: ChatMessageData[] = [
    message({ id: 'u1', role: 'user', startedAt: 1000 }),
    message({ id: 'a1', role: 'ai', startedAt: 1100, completedAt: 2000 }),
    message({ id: 'u2', role: 'user', startedAt: 3000 }),
    message({ id: 'a2', role: 'ai', startedAt: 3100, completedAt: 4000 }),
  ];
  const footers = [null, footer(1, 0), null, footer(3, 2)];

  test('a write belongs to the run whose window contains it', () => {
    const buckets = bucketChangesByRun(messages, footers, [
      record({ at: 1500, path: '/repo/a.ts', displayPath: 'a.ts' }),
      record({ at: 3500, path: '/repo/b.ts', displayPath: 'b.ts' }),
    ]);
    expect(buckets.get(1)?.map((file) => file.displayPath)).toEqual(['a.ts']);
    expect(buckets.get(3)?.map((file) => file.displayPath)).toEqual(['b.ts']);
  });

  test('a run id wins over the wall-clock window', () => {
    // `runAt` 900 is just before the first window (1000); the change at 2500 is
    // outside every window, but the run id says it belongs to run 1.
    const buckets = bucketChangesByRun(messages, footers, [
      record({ at: 2500, runId: 'r1', runAt: 900, path: '/repo/late.ts', displayPath: 'late.ts' }),
    ]);
    expect(buckets.get(1)?.map((file) => file.displayPath)).toEqual(['late.ts']);
  });

  test('a late subagent change keeps its run', () => {
    const buckets = bucketChangesByRun(messages, footers, [
      record({ at: 5000, runId: 'r1', runAt: 1000, path: '/repo/late.ts', displayPath: 'late.ts' }),
    ]);
    expect(buckets.get(1)?.map((file) => file.displayPath)).toEqual(['late.ts']);
  });

  test('a write outside every window is dropped', () => {
    const buckets = bucketChangesByRun(messages, footers, [record({ at: 2500 })]);
    expect(buckets.size).toBe(0);
  });

  test('a file written twice shows the net change', () => {
    const buckets = bucketChangesByRun(messages, footers, [
      record({ at: 1200, before: 'b1', after: 'b2' }),
      record({ at: 1300, before: 'b2', after: 'b3' }),
    ]);
    expect(buckets.get(1)).toEqual([
      { path: '/repo/a.ts', displayPath: 'a.ts', status: 'modified', agent: 'Main' },
    ]);
  });

  test('created and deleted in one run is not a change', () => {
    const buckets = bucketChangesByRun(messages, footers, [
      record({ at: 1200, before: null, after: 'b2' }),
      record({ at: 1300, before: 'b2', after: null }),
    ]);
    expect(buckets.size).toBe(0);
  });

  test('written back to the same blob is not a change', () => {
    const buckets = bucketChangesByRun(messages, footers, [
      record({ at: 1200, before: 'b1', after: 'b2' }),
      record({ at: 1300, before: 'b2', after: 'b1' }),
    ]);
    expect(buckets.size).toBe(0);
  });

  test('added and deleted statuses come from the first before and last after', () => {
    const buckets = bucketChangesByRun(messages, footers, [
      record({ at: 1200, path: '/repo/new.ts', displayPath: 'new.ts', before: null, after: 'b2' }),
      record({ at: 1300, path: '/repo/gone.ts', displayPath: 'gone.ts', before: 'b1', after: null }),
    ]);
    expect(buckets.get(1)?.map((file) => file.status)).toEqual(['deleted', 'added']);
  });

  test('a patch record states its status without a key, and create-then-delete nets out', () => {
    const buckets = bucketChangesByRun(messages, footers, [
      record({ at: 1200, path: '/repo/added.ts', displayPath: 'added.ts', before: null, after: undefined, existedBefore: false, existsAfter: true }),
      record({ at: 1300, path: '/repo/gone.ts', displayPath: 'gone.ts', before: 'k1', after: undefined, existedBefore: true, existsAfter: false }),
      record({ at: 1400, path: '/repo/temp.ts', displayPath: 'temp.ts', before: null, after: undefined, existedBefore: false, existsAfter: true }),
      record({ at: 1500, path: '/repo/temp.ts', displayPath: 'temp.ts', before: undefined, after: undefined, existedBefore: true, existsAfter: false }),
    ]);
    expect(buckets.get(1)?.map((file) => [file.displayPath, file.status])).toEqual([
      ['added.ts', 'added'],
      ['gone.ts', 'deleted'],
    ]);
  });

  test('a subagent write keeps its agent id', () => {
    const buckets = bucketChangesByRun(messages, footers, [
      record({ at: 1200, agent: 'AuthLoader' }),
    ]);
    expect(buckets.get(1)?.[0]?.agent).toBe('AuthLoader');
  });

  test('a session that starts mid-run uses the first row as the window start', () => {
    // The first run has no user row (`runStartIndex` is -1). Falling back to
    // the OWNER row's start would begin the window at the last assistant
    // message, after every write the run made.
    const midRun: ChatMessageData[] = [
      message({ id: 'a0', role: 'ai', startedAt: 1000, completedAt: 1200 }),
      message({ id: 'a1', role: 'ai', startedAt: 1300, completedAt: 2000 }),
    ];
    const buckets = bucketChangesByRun(midRun, [null, footer(1, -1)], [record({ at: 1500 })]);
    expect(buckets.get(1)?.length).toBe(1);
  });
});
