/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The sidebar CONTROLLER, mounted, with the pending store behind it.
 *
 * The store's own suite pins the retention rules; this one pins the wiring that
 * made them unreachable, which is where the reported bug actually lived:
 *
 *   - the row is folded in for BOTH layouts (the phone never asked for the
 *     placeholder, so a new chat had no row at all until omp's transcript
 *     landed), and
 *   - the row survives the user clicking another session — the previous shape
 *     derived it from `?sessionId=`, so it left with the URL and came back
 *     seconds later, which is exactly "hilang dan muncul setelah beberapa saat".
 *
 * Mounted through the real provider against a real realtime server, because the
 * folders it folds the row into come off the socket. The mounting lives in
 * `test-support/sidebar-controller-harness.test-util.ts`, shared with the folder-open
 * suite so both measure one harness.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'preact/test-utils';

import { listPendingSessions, releasePendingSession, startPendingSession } from '@/client/hooks/chat/omp/pending-sessions';
import { forgetSession, setSessionKey } from '@/shared/lib/workspace/session-state/store';
import { CHAT_DRAFT_KEY } from '@/shared/lib/chat/composer/draft';
import { TOPIC_SIDEBAR } from '@/shared/lib/realtime/protocol';
import { restoreDomGlobals } from '@/test-support/pristine-globals';
import type { SidebarPayload } from '@kabmo-labs/kabmo-app-contracts/realtime';
import {
  disposeSidebarController,
  mountSidebarController,
  renderedSessionIds,
} from '@/test-support/sidebar-controller-harness.test-util';

afterEach(() => disposeSidebarController());

// The store is PROCESS state, and `bun test` shares one module registry across
// files: an entry a sibling suite left behind is injected into this file's
// folders (its `folderId` does not exist here, so it lands in the first one) and
// the rows under test are no longer the rows at index 0. Cleared per case.
beforeEach(() => {
  for (const entry of listPendingSessions()) releasePendingSession(entry.id);
});

afterAll(() => {
  restoreDomGlobals();
});

describe('a new chat shows in the sidebar before omp writes its transcript', () => {
  test('the row is rendered from the click with the PHONE\'s call (no options)', async () => {
    // No options at all: the drawer passes none, and a row that only exists
    // when a layout asks for it is the reported "di mobile awalnya ndak muncul".
    const harness = await mountSidebarController('?sessionId=real-1');
    const id = startPendingSession(7);
    await harness.setUrl(`?sessionId=${id}&folderId=7`);

    expect(renderedSessionIds(harness.holder.api)).toEqual([id, 'real-1']);
    // The folder opens, or the row exists off screen — and on the phone this is
    // the seed its drawer expands from.
    expect(harness.holder.api?.processedFolders[0]?.isExpanded).toBe(true);

    releasePendingSession(id);
    harness.server.stop();
  });

  test('the row survives switching to another session', async () => {
    const harness = await mountSidebarController('?sessionId=real-1');
    const id = startPendingSession(7);
    await harness.setUrl(`?sessionId=${id}&folderId=7`);
    expect(renderedSessionIds(harness.holder.api)).toContain(id);

    // The reported failure: clicking another session dropped the row, which
    // then reappeared once omp's scan caught up.
    await harness.setUrl('?sessionId=real-1');
    expect(renderedSessionIds(harness.holder.api)).toEqual([id, 'real-1']);

    releasePendingSession(id);
    harness.server.stop();
  });

  test('the row goes when the user leaves a chat they never typed into', async () => {
    // The reported behaviour: click New Session, type nothing, click another
    // session — and the empty chat stayed in the sidebar for good. The row is
    // kept for a DRAFT, so an empty composer is the negative answer.
    const harness = await mountSidebarController('?sessionId=real-1');
    const id = startPendingSession(7);
    await harness.setUrl(`?sessionId=${id}&folderId=7`);
    expect(renderedSessionIds(harness.holder.api)).toContain(id);

    // What the timeline writes once the chat's blob has loaded and the composer
    // is blank — the state on screen right after the click.
    await act(async () => {
      setSessionKey(id, CHAT_DRAFT_KEY, '');
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
    });

    await harness.setUrl('?sessionId=real-1');
    expect(renderedSessionIds(harness.holder.api)).toEqual(['real-1']);

    forgetSession(id);
    harness.server.stop();
  });

  test('a row the structure carries supersedes the pending one', async () => {
    const harness = await mountSidebarController('?sessionId=real-1');
    const id = startPendingSession(7);
    await harness.setUrl(`?sessionId=${id}&folderId=7`);
    expect(renderedSessionIds(harness.holder.api)).toContain(id);

    // omp's file landed: the server's own row is now in the payload, so the
    // pending entry goes and the session is drawn exactly once.
    const server = harness.server;
    server.publish(TOPIC_SIDEBAR, {
      folders: [{
        id: 7,
        name: 'ws',
        isExpanded: true,
        hasMore: false,
        totalSessions: 2,
        sessions: [
          { id, folder_id: 7, title: 'Named by omp' },
          { id: 'real-1', folder_id: 7, title: 'A real chat' },
        ],
      }],
      isMock: false,
    });
    await server.waitForTopic<SidebarPayload>(TOPIC_SIDEBAR, (value) => (
      (value?.folders[0]?.sessions ?? []).some((session) => session.title === 'Named by omp')
    ));
    await act(async () => {
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
    });

    const ids = renderedSessionIds(harness.holder.api);
    expect(ids.filter((entry) => entry === id)).toHaveLength(1);
    expect(harness.holder.api?.processedFolders[0]?.sessions?.[0]?.title).toBe('Named by omp');

    releasePendingSession(id);
    server.stop();
  });
});

describe('the sidebar search finds a session by its id', () => {
  test('a pasted id narrows the list to that row', async () => {
    const harness = await mountSidebarController('?sessionId=real-1');
    await act(async () => {
      harness.holder.api?.setSearchQuery('real-1');
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
    });
    expect(renderedSessionIds(harness.holder.api)).toEqual(['real-1']);

    // A title that does not contain the id is still found by the id alone.
    await act(async () => {
      harness.holder.api?.setSearchQuery('REAL-1');
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
    });
    expect(renderedSessionIds(harness.holder.api)).toEqual(['real-1']);

    harness.server.stop();
  });
});

describe('the sidebar harness filter', () => {
  test('narrows the list to one agent and drops a workspace with nothing left', async () => {
    const harness = await mountSidebarController('?sessionId=real-1');
    const server = harness.server;
    server.publish(TOPIC_SIDEBAR, {
      folders: [
        {
          id: 7,
          name: 'ws',
          isExpanded: true,
          hasMore: false,
          totalSessions: 3,
          sessions: [
            { id: 'real-1', folder_id: 7, title: 'omp chat', harness: 'omp-rpc' },
            { id: 'omp-2', folder_id: 7, title: 'another omp chat', harness: 'omp-rpc' },
            { id: 'claude-1', folder_id: 7, title: 'claude chat', harness: 'claude' },
          ],
        },
        {
          id: 8,
          name: 'other',
          isExpanded: true,
          hasMore: false,
          totalSessions: 1,
          sessions: [{ id: 'codex-1', folder_id: 8, title: 'codex chat', harness: 'codex' }],
        },
      ],
      isMock: false,
    });
    await server.waitForTopic<SidebarPayload>(TOPIC_SIDEBAR, (value) => (value?.folders ?? []).length === 2);
    await act(async () => {
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
    });

    // The menu counts the whole list, most-used first.
    expect(harness.holder.api?.harnessOptions).toEqual([
      { harness: 'omp-rpc', label: 'omp', count: 2 },
      { harness: 'claude', label: 'claude', count: 1 },
      { harness: 'codex', label: 'codex', count: 1 },
    ]);

    await act(async () => {
      harness.holder.api?.setHarnessFilter('claude');
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
    });
    expect(renderedSessionIds(harness.holder.api)).toEqual(['claude-1']);
    // A workspace with nothing left to show is dropped, not drawn empty.
    expect(harness.holder.api?.processedFolders.map((folder) => folder.id)).toEqual([7]);
    // The counts stay a fact about the workspaces, not about the narrowed list.
    expect(harness.holder.api?.harnessOptions.map((option) => option.count)).toEqual([2, 1, 1]);

    await act(async () => {
      harness.holder.api?.setHarnessFilter(null);
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
    });
    expect(renderedSessionIds(harness.holder.api)).toEqual(['codex-1', 'real-1', 'omp-2', 'claude-1']);

    server.stop();
  });
});
