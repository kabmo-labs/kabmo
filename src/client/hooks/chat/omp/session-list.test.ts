/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The mounted `SidebarDataProvider` over the unified realtime channel: the
 * STATUS half, the seen-strip overlay, and the title hint.
 *
 * The activity topic's merge rules live in `session-list.activity.test.ts` —
 * separate because the two halves answer different questions and the file was
 * over the repo's ceiling with both.
 */

import { afterAll, afterEach, describe, expect, test } from 'bun:test';

import { applySeenStrip, SESSION_TITLE_HINT_SIGNAL } from '@/client/hooks/chat/omp/sidebar-overlay';
import { publishClientSignal } from '@/client/lib/signals';
import { restoreDomGlobals } from '@/test-support/pristine-globals';
import {
  folders,
  mountProvider,
  renderedStatus,
  statusBody,
  teardownProvider,
  withAct,
} from '@/client/hooks/chat/omp/session-list.test-util';

afterEach(teardownProvider);

afterAll(() => {
  restoreDomGlobals();
});

describe('SidebarDataProvider reads both sidebar topics', () => {
  test('reports a live run for a session the structure has not scanned yet', async () => {
    // A fresh spawn: omp writes the session file only when the first assistant
    // message settles (measured ~17s), so no structure row exists. The status
    // payload carries the `stream` row all the same, and the sidebar's
    // PLACEHOLDER row reads it from the map.
    const harness = await mountProvider();
    await harness.push(undefined, { 'omp-1': { streamStatus: 'stream' } });
    expect(harness.holder.api?.streamStatusMap['omp-1']).toBe('stream');
    expect(harness.holder.api?.folders[0]?.sessions?.length).toBe(1);
    harness.server.stop();
  });

  test('never invents `stream` — the map is empty while the server reports idle', async () => {
    const harness = await mountProvider();
    expect(harness.holder.api?.streamStatusMap).toEqual({});
    expect(renderedStatus(harness.holder.api)).toBeUndefined();

    await harness.push(undefined, statusBody());
    expect(harness.holder.api?.streamStatusMap).toEqual({});
    harness.server.stop();
  });

  test('a re-publish that still reports the run keeps it, and its end clears it', async () => {
    const harness = await mountProvider();
    await harness.push(undefined, statusBody('stream'));
    await harness.push(undefined, statusBody('stream'));
    expect(renderedStatus(harness.holder.api)).toBe('stream');

    // The server released its row: nothing client-side can hold the spinner on.
    await harness.push(undefined, statusBody());
    expect(renderedStatus(harness.holder.api)).toBeUndefined();
    harness.server.stop();
  });
});

/**
 * The one client-side overlay, which can only ever REMOVE a status.
 *
 * A run in flight is never invented here — that is the whole point of removing
 * the optimistic mark: a client-owned `stream` whose release depended on the
 * client naming the same session id is what left a spinner turning after the
 * run had ended.
 */
describe('applySeenStrip', () => {
  test('hides a terminal badge this mount acked, and never a live `stream` row', () => {
    const out = applySeenStrip(
      folders([{ id: 'a', streamStatus: 'finish' }, { id: 'b', streamStatus: 'stream' }]),
      new Set(['a', 'b']),
    );
    expect(out[0]?.sessions?.[0]?.streamStatus).toBeUndefined();
    expect(out[0]?.sessions?.[1]?.streamStatus).toBe('stream');
  });

  test('returns the same array when nothing was acked', () => {
    const base = folders([{ id: 'a', streamStatus: 'finish' }]);
    expect(applySeenStrip(base, new Set())).toBe(base);
  });
});

describe('SidebarDataProvider carries the sent text for a placeholder row', () => {
  /** Fire the hint the send path publishes for a session omp has not scanned. */
  function hint(sessionId: string, title: string): void {
    publishClientSignal(SESSION_TITLE_HINT_SIGNAL, { sessionId, title });
  }

  test('exposes the text the user just sent, by session id', async () => {
    const harness = await mountProvider();
    expect(harness.holder.api?.titleHint('omp-1')).toBeUndefined();

    await withAct(() => hint('omp-1', 'Perbaiki tombol stop'));

    expect(harness.holder.api?.titleHint('omp-1')).toBe('Perbaiki tombol stop');
    expect(harness.holder.api?.titleHint('omp-2')).toBeUndefined();
    expect(harness.holder.api?.titleHint(null)).toBeUndefined();
    harness.server.stop();
  });

  test('ignores a blank hint and drops one once the session is listed', async () => {
    const harness = await mountProvider();
    await withAct(() => hint('a', '   '));
    expect(harness.holder.api?.titleHint('a')).toBeUndefined();

    await withAct(() => hint('a', 'sent text'));
    expect(harness.holder.api?.titleHint('a')).toBe('sent text');

    // The session is in the structure, so the placeholder is not drawn and the
    // hint has nothing left to stand in for. A status delta is enough: the
    // cleanup runs on every snapshot, and the structure already carries `a`.
    await harness.push(undefined, statusBody('stream'));
    expect(harness.holder.api?.titleHint('a')).toBeUndefined();
    harness.server.stop();
  });
});

/**
 * `sidebar:activity` is the topic a tool call republishes, and the merge rules
 * are what make a payload that carries ONLY the running sessions sufficient.
 *
 * The structure is the authority for every row and is re-scanned at every turn
 * boundary; this topic only ever moves the two fields a run advances mid-turn.
 * Two ways that can go wrong, both pinned below: a late frame moving a row
 * BACKWARDS (which reorders the sidebar under the reader), and the merge
 * re-sorting 731 rows for a stamp that did not move.
 */