/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `sidebar:activity` — the topic a tool call republishes.
 *
 * Its whole reason to exist is that the STRUCTURE must not be republished per
 * tool call (216 KB over 731 sessions, measured), so the merge has to be exact:
 * it may only ever move the two fields a run advances mid-turn, and only
 * forwards. Each case below is a way that goes wrong.
 */

import { afterAll, afterEach, describe, expect, test } from 'bun:test';

import { restoreDomGlobals } from '@/test-support/pristine-globals';
import {
  mountProvider,
  structureBody,
  teardownProvider,
} from '@/client/hooks/chat/omp/session-list.test-util';

afterEach(teardownProvider);

afterAll(() => {
  restoreDomGlobals();
});

describe('SidebarDataProvider merges the activity topic', () => {
  test('advances a running row past the stamp the structure shipped', async () => {
    const harness = await mountProvider();
    await harness.push(
      {
        folders: [{
          id: 1, name: 'ws', isExpanded: true, hasMore: false, totalSessions: 1,
          sessions: [{ id: 'a', folder_id: 1, title: 'A', updated_at: '2026-10-24T01:00:00.000Z' }],
        }],
        isMock: false,
      },
    );
    expect(harness.holder.api?.folders[0]?.sessions?.[0].updated_at).toBe('2026-10-24T01:00:00.000Z');

    await harness.push(undefined, undefined, { a: { updatedAt: '2026-10-24T01:05:00.000Z' } });
    expect(harness.holder.api?.folders[0]?.sessions?.[0].updated_at).toBe('2026-10-24T01:05:00.000Z');
    harness.server.stop();
  });

  test('never moves a row backwards, so a late frame cannot reorder the list', async () => {
    const harness = await mountProvider();
    // The structure already carries a stamp the activity payload has not caught
    // up with — the normal case right after a turn boundary.
    await harness.push({
      folders: [{
        id: 1, name: 'ws', isExpanded: true, hasMore: false, totalSessions: 1,
        sessions: [{ id: 'a', folder_id: 1, title: 'A', updated_at: '2026-10-24T02:00:00.000Z' }],
      }],
      isMock: false,
    });

    await harness.push(undefined, undefined, { a: { updatedAt: '2026-10-24T01:59:00.000Z' } });
    expect(harness.holder.api?.folders[0]?.sessions?.[0].updated_at).toBe('2026-10-24T02:00:00.000Z');
    harness.server.stop();
  });

  test('lights the subagent chevron for a subagent seen mid-run', async () => {
    const harness = await mountProvider();
    await harness.push(structureBody());
    expect(harness.holder.api?.folders[0]?.sessions?.[0].hasSubagents).toBeFalsy();

    await harness.push(undefined, undefined, { a: { updatedAt: '2026-10-24T01:05:00.000Z', hasSubagents: true } });
    expect(harness.holder.api?.folders[0]?.sessions?.[0].hasSubagents).toBe(true);
    harness.server.stop();
  });

  test('a live read that saw no subagent does not clear a chevron the scan lit', async () => {
    // The two sources run the SAME presence check, but the structure's answer
    // came from a full scan and this one from a live read of one file. A
    // `false` here is "not seen in this read", so it must not unlight a row —
    // the merge ORs against the structure for exactly that reason.
    const harness = await mountProvider();
    await harness.push({
      folders: [{
        id: 1, name: 'ws', isExpanded: true, hasMore: false, totalSessions: 1,
        sessions: [{ id: 'a', folder_id: 1, title: 'A', hasSubagents: true }],
      }],
      isMock: false,
    });

    await harness.push(undefined, undefined, { a: { updatedAt: '2026-10-24T01:05:00.000Z', hasSubagents: false } });
    expect(harness.holder.api?.folders[0]?.sessions?.[0].hasSubagents).toBe(true);
    harness.server.stop();
  });

  test('leaves an id the payload does not name on the structure stamp', async () => {
    const harness = await mountProvider();
    await harness.push({
      folders: [{
        id: 1, name: 'ws', isExpanded: true, hasMore: false, totalSessions: 2,
        sessions: [
          { id: 'a', folder_id: 1, title: 'A', updated_at: '2026-10-24T01:00:00.000Z' },
          { id: 'b', folder_id: 1, title: 'B', updated_at: '2026-10-24T00:30:00.000Z' },
        ],
      }],
      isMock: false,
    });

    await harness.push(undefined, undefined, { a: { updatedAt: '2026-10-24T01:05:00.000Z' } });
    const sessions = harness.holder.api?.folders[0]?.sessions ?? [];
    expect(sessions[0]?.updated_at).toBe('2026-10-24T01:05:00.000Z');
    expect(sessions[1]?.updated_at).toBe('2026-10-24T00:30:00.000Z');
    harness.server.stop();
  });
});
