/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
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
 * folders it folds the row into come off the socket.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { useSessionSidebarController } from '@/client/hooks/chat/omp/session-sidebar-controller';
import { listPendingSessions, releasePendingSession, startPendingSession } from '@/client/hooks/chat/omp/pending-sessions';
import { forgetSession, setSessionKey } from '@/shared/lib/workspace/session-state/store';
import { CHAT_DRAFT_KEY } from '@/shared/lib/chat/composer/draft';
import { SidebarDataProvider } from '@/client/hooks/chat/omp/session-list';
import { resetRealtimeClient } from '@/shared/lib/realtime/client';
import { TOPIC_SIDEBAR, TOPIC_SIDEBAR_STATUS } from '@/shared/lib/realtime/protocol';
import { startRealtimeTestServer, type RealtimeTestServer } from '@/test-support/realtime-server';
import type { TopicResolver } from '@/server/lib/realtime/hub.server';
import { installDomGlobals, pristineWebSocket, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { SidebarPayload, SidebarStatusPayload } from '@/shared/types/realtime';
import type { WorkspaceFolderData } from '@/shared/types';
import type { SessionSidebarController } from '@/client/hooks/chat/omp/session-sidebar-controller';

let container: HTMLElement | undefined;

function installDom(origin: string): void {
  installDomGlobals(new Window({ url: origin }));
  (globalThis as unknown as Record<string, unknown>).WebSocket = pristineWebSocket;
}

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
  container = undefined;
  resetRealtimeClient();
});

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

/** The seeded structure: one folder holding one real session. */
function structureBody(): SidebarPayload {
  return {
    folders: [{
      id: 7,
      name: 'ws',
      isExpanded: false,
      hasMore: false,
      totalSessions: 1,
      sessions: [{ id: 'real-1', folder_id: 7, title: 'A real chat' }],
    }],
    isMock: false,
  };
}

interface Harness {
  server: RealtimeTestServer;
  holder: { api: SessionSidebarController | null };
  /** Re-point the URL the controller reads (`?sessionId=`). */
  setUrl: (search: string) => Promise<void>;
}

/** Mount the real controller under the real provider.
 *
 *  `options` is left EMPTY by default, which is exactly the phone's call — the
 *  mobile sidebar passes none — so a case mounted that way proves the row is
 *  not something a layout has to ask for. It used to be: only the desktop
 *  passed `includePendingSessions`, which is why a new chat had no row at all
 *  on a phone until omp's transcript landed. */
async function mountController(url = '?sessionId=real-1', options: Parameters<typeof useSessionSidebarController>[1] = {}): Promise<Harness> {
  const server = await startRealtimeTestServer(new Map<string, TopicResolver>([
    [TOPIC_SIDEBAR, async () => structureBody()],
    [TOPIC_SIDEBAR_STATUS, async (): Promise<SidebarStatusPayload> => ({})],
  ]));
  installDom(`http://127.0.0.1:${server.port}/`);
  window.history.replaceState(null, '', `/${url}`);
  window.dispatchEvent(new Event('popstate'));

  const holder: { api: SessionSidebarController | null } = { api: null };
  function Probe() {
    holder.api = useSessionSidebarController({}, options);
    return null;
  }
  const el = document.createElement('div');
  document.body.appendChild(el);
  container = el;
  await act(async () => {
    render(h(SidebarDataProvider, { children: h(Probe, null) }), el);
  });
  await server.waitForTopic<SidebarPayload>(TOPIC_SIDEBAR, (value) => value !== null);
  await act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  });

  return {
    server,
    holder,
    setUrl: async (search) => {
      window.history.replaceState(null, '', `/${search}`);
      window.dispatchEvent(new Event('popstate'));
      await act(async () => {
        for (let i = 0; i < 8; i += 1) await Promise.resolve();
      });
    },
  };
}

/** Every session id the rendered list carries, across all folders. */
function renderedIds(api: SessionSidebarController | null): string[] {
  return (api?.processedFolders ?? []).flatMap((folder: WorkspaceFolderData) => (
    (folder.sessions ?? []).map((session) => String(session.id))
  ));
}

describe('a new chat shows in the sidebar before omp writes its transcript', () => {
  test('the row is rendered from the click with the PHONE\'s call (no options)', async () => {
    // No options at all: the drawer passes none, and a row that only exists
    // when a layout asks for it is the reported "di mobile awalnya ndak muncul".
    const harness = await mountController('?sessionId=real-1');
    const id = startPendingSession(7);
    await harness.setUrl(`?sessionId=${id}&folderId=7`);

    expect(renderedIds(harness.holder.api)).toEqual([id, 'real-1']);
    // The folder opens, or the row exists off screen — and on the phone this is
    // the seed its drawer expands from.
    expect(harness.holder.api?.processedFolders[0]?.isExpanded).toBe(true);

    releasePendingSession(id);
    harness.server.stop();
  });

  test('the row survives switching to another session', async () => {
    const harness = await mountController('?sessionId=real-1');
    const id = startPendingSession(7);
    await harness.setUrl(`?sessionId=${id}&folderId=7`);
    expect(renderedIds(harness.holder.api)).toContain(id);

    // The reported failure: clicking another session dropped the row, which
    // then reappeared once omp's scan caught up.
    await harness.setUrl('?sessionId=real-1');
    expect(renderedIds(harness.holder.api)).toEqual([id, 'real-1']);

    releasePendingSession(id);
    harness.server.stop();
  });

  test('the row goes when the user leaves a chat they never typed into', async () => {
    // The reported behaviour: click New Session, type nothing, click another
    // session — and the empty chat stayed in the sidebar for good. The row is
    // kept for a DRAFT, so an empty composer is the negative answer.
    const harness = await mountController('?sessionId=real-1');
    const id = startPendingSession(7);
    await harness.setUrl(`?sessionId=${id}&folderId=7`);
    expect(renderedIds(harness.holder.api)).toContain(id);

    // What the timeline writes once the chat's blob has loaded and the composer
    // is blank — the state on screen right after the click.
    await act(async () => {
      setSessionKey(id, CHAT_DRAFT_KEY, '');
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
    });

    await harness.setUrl('?sessionId=real-1');
    expect(renderedIds(harness.holder.api)).toEqual(['real-1']);

    forgetSession(id);
    harness.server.stop();
  });

  test('a row the structure carries supersedes the pending one', async () => {
    const harness = await mountController('?sessionId=real-1');
    const id = startPendingSession(7);
    await harness.setUrl(`?sessionId=${id}&folderId=7`);
    expect(renderedIds(harness.holder.api)).toContain(id);

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

    const ids = renderedIds(harness.holder.api);
    expect(ids.filter((entry) => entry === id)).toHaveLength(1);
    expect(harness.holder.api?.processedFolders[0]?.sessions?.[0]?.title).toBe('Named by omp');

    releasePendingSession(id);
    server.stop();
  });
});

describe('a folder opens when a row inside it needs to be seen', () => {
  /** Capture the expand writes the controller issues, and answer them. */
  function stubToggleWrites(): { toggles: string[]; restore: () => void } {
    const toggles: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      // Only the folder toggle is under test; the sidebar's other requests
      // (the waiting list) still have to resolve, so they are answered too.
      if (url.includes('/api/folders/')) {
        const body = init?.body instanceof URLSearchParams ? init.body : new URLSearchParams();
        toggles.push(`${url} ${body.get('isExpanded')}`);
      }
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    return { toggles, restore: () => { globalThis.fetch = original; } };
  }

  async function flush(): Promise<void> {
    await act(async () => {
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
    });
  }

  /** Publish a run over the real socket, INSIDE `act` so the render it causes
   *  flushes its effects before the assertions run. */
  async function publishRun(harness: Harness): Promise<void> {
    await act(async () => {
      harness.server.publish(TOPIC_SIDEBAR_STATUS, { 'real-1': { streamStatus: 'stream' } });
      await harness.server.waitForTopic<SidebarStatusPayload>(
        TOPIC_SIDEBAR_STATUS,
        (value) => value?.['real-1']?.streamStatus === 'stream',
      );
    });
    await flush();
  }

  test('a run in flight opens its collapsed folder and stores the flag', async () => {
    const harness = await mountController('?sessionId=real-1');
    const writes = stubToggleWrites();
    try {
      await publishRun(harness);

      // Both halves: the list renders the folder open NOW, and the write makes
      // it survive the run ending and a reload.
      expect(harness.holder.api?.processedFolders[0]?.isExpanded).toBe(true);
      expect(writes.toggles).toEqual(['/api/folders/7/toggle true']);
    } finally {
      writes.restore();
      harness.server.stop();
    }
  });

  test('a run is written open ONCE, not on every structure push', async () => {
    const harness = await mountController('?sessionId=real-1');
    const writes = stubToggleWrites();
    try {
      await publishRun(harness);
      expect(writes.toggles).toHaveLength(1);

      // A tool call republishes the structure mid-run. A payload that DIFFERS
      // (the rename) is what makes the client re-render the list, so the effect
      // really is given a chance to write again.
      await act(async () => {
        harness.server.publish(TOPIC_SIDEBAR, {
          folders: [{ ...structureBody().folders[0], name: 'ws renamed' }],
          isMock: false,
        });
        await harness.server.waitForTopic<SidebarPayload>(
          TOPIC_SIDEBAR,
          (value) => value?.folders[0]?.name === 'ws renamed',
        );
      });
      await flush();

      expect(writes.toggles).toHaveLength(1);
    } finally {
      writes.restore();
      harness.server.stop();
    }
  });

  test('a new chat opens and STORES its folder', async () => {
    const harness = await mountController('?sessionId=real-1');
    const writes = stubToggleWrites();
    const id = startPendingSession(7);
    try {
      await harness.setUrl(`?sessionId=${id}&folderId=7`);
      await flush();

      expect(writes.toggles).toEqual(['/api/folders/7/toggle true']);
    } finally {
      releasePendingSession(id);
      writes.restore();
      harness.server.stop();
    }
  });
});
