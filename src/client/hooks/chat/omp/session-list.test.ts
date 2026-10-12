/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The mounted `SidebarDataProvider` over the unified realtime channel.
 *
 * Driven through a REAL server and a real socket rather than a stubbed fetch,
 * because what the provider does now is merge two topics and apply the
 * optimistic overlays — the parts that used to be "does it re-read". A stubbed
 * socket would only prove the fake's timing.
 *
 * Kept: the two-topic merge, the authoritative status map (including a session
 * the structure has not scanned), the seen-strip on an acked terminal badge, and
 * the title hint.
 */

import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { applySeenStrip, SESSION_TITLE_HINT_SIGNAL } from '@/client/hooks/chat/omp/sidebar-overlay';
import { publishClientSignal } from '@/client/lib/signals';
import { SidebarDataProvider, useSidebarData } from '@/client/hooks/chat/omp/session-list';
import type { SidebarDataHandle } from '@/client/hooks/chat/omp/session-list';
import { resetRealtimeClient } from '@/shared/lib/realtime/client';
import { TOPIC_SIDEBAR, TOPIC_SIDEBAR_STATUS } from '@/shared/lib/realtime/protocol';
import { startRealtimeTestServer, type RealtimeTestServer } from '@/test-support/realtime-server';
import type { TopicResolver } from '@/server/lib/realtime/hub.server';
import { installDomGlobals, pristineWebSocket, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { SidebarPayload, SidebarStatusPayload } from '@/client/hooks/chat/omp/session-list';
import type { WorkspaceFolderData } from '@/shared/types';


let container: HTMLElement | undefined;

/**
 * Point the DOM globals at a happy-dom window whose origin is the test
 * listener, because the client builds its socket URL from `window.location` —
 * a window on a different port would dial a server that is not there, and the
 * test would be measuring a connection failure rather than the channel.
 */
function installDom(origin: string): void {
  const win = new Window({ url: origin });
  installDomGlobals(win);
  // happy-dom's WebSocket does not reach a real listener, and the channel is
  // what is under test, so the real implementation wins this global.
  (globalThis as unknown as Record<string, unknown>).WebSocket = pristineWebSocket;
}



afterEach(() => {
  if (container) render(null, container);
  container?.remove();
  container = undefined;
  resetRealtimeClient();
});

afterAll(() => {
  restoreDomGlobals();
});



type Status = 'stream' | 'finish' | 'abort';

/** A structure payload carrying one session, `a`. */
function structureBody(): SidebarPayload {
  return {
    folders: [{ id: 1, name: 'ws', isExpanded: true, hasMore: false, totalSessions: 1, sessions: [{ id: 'a', folder_id: 1, title: 'A' }] }],
    isMock: false,
  };
}

/** The volatile map for `a`. */
function statusBody(status?: Status): SidebarStatusPayload {
  return status ? { a: { streamStatus: status } } : {};
}

/** One folder holding the given sessions, shaped only as far as the strip reads it. */
function folders(sessions: Array<{ id: string; streamStatus?: Status }>): WorkspaceFolderData[] {
  return [{ id: 1, name: 'ws', sessions }] as unknown as WorkspaceFolderData[];
}

/** The status the provider currently renders for session `a`. */
function renderedStatus(api: SidebarDataHandle | null): Status | undefined {
  return api?.folders[0]?.sessions?.[0].streamStatus;
}

/**
 * Let Preact's queued effects run.
 *
 * A microtask drain, and deliberately nothing more: the socket's own progress
 * is awaited through the harness (`waitForFrames`), so this only has to flush
 * the render a received frame queued.
 */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

interface Harness {
  server: RealtimeTestServer;
  holder: { api: SidebarDataHandle | null };
  /** Republish both topics from the current bodies. */
  push: (structure?: SidebarPayload, status?: SidebarStatusPayload) => Promise<void>;
}

/** Mount the real provider against a real realtime server. */
async function mountProvider(): Promise<Harness> {
  const server = await startRealtimeTestServer(new Map<string, TopicResolver>([
    [TOPIC_SIDEBAR, async () => structureBody()],
    [TOPIC_SIDEBAR_STATUS, async () => statusBody()],
  ]));
  installDom(`http://127.0.0.1:${server.port}`);

  const holder: { api: SidebarDataHandle | null } = { api: null };
  function Probe() {
    holder.api = useSidebarData();
    return null;
  }
  const el = document.createElement('div');
  document.body.appendChild(el);
  container = el;
  await act(async () => {
    render(h(SidebarDataProvider, { children: h(Probe, null) }), el);
  });
  // The structure snapshot must have landed before the provider can report a
  // value at all; the subscription is opened by the render above, so this
  // awaits the client's own state rather than a duration.
  await server.waitForTopic<SidebarPayload>(TOPIC_SIDEBAR, (value) => value !== null);
  await act(async () => {
    await flush();
  });

  return {
    server,
    holder,
    push: async (structure, status) => {
      // Await the CLIENT's value, not just the publish: the socket round trip
      // and the provider's merge are the things under test, so resolving on the
      // send would assert against a state that has not happened yet.
      if (structure) {
        server.publish(TOPIC_SIDEBAR, structure);
        await server.waitForTopic(TOPIC_SIDEBAR, (value) => JSON.stringify(value) === JSON.stringify(structure));
      }
      if (status) {
        server.publish(TOPIC_SIDEBAR_STATUS, status);
        await server.waitForTopic(TOPIC_SIDEBAR_STATUS, (value) => JSON.stringify(value) === JSON.stringify(status));
      }
      await act(async () => {
        await flush();
      });
    },
  };
}

describe('SidebarDataProvider reads both sidebar topics', () => {
  test('paints the structure from the snapshot, without any fetch', async () => {
    const { holder, server } = await mountProvider();
    expect(holder.api?.initializing).toBe(false);
    expect(holder.api?.folders).toHaveLength(1);
    expect(holder.api?.folders[0]?.sessions[0]?.title).toBe('A');
    server.stop();
  });

  test('merges the volatile status onto the session it belongs to', async () => {
    const harness = await mountProvider();
    expect(renderedStatus(harness.holder.api)).toBeUndefined();

    await harness.push(undefined, statusBody('stream'));
    expect(renderedStatus(harness.holder.api)).toBe('stream');

    // A terminal badge, then cleared — the map is authoritative for removals.
    await harness.push(undefined, statusBody('finish'));
    expect(renderedStatus(harness.holder.api)).toBe('finish');
    await harness.push(undefined, statusBody());
    expect(renderedStatus(harness.holder.api)).toBeUndefined();

    harness.server.stop();
  });

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

    await act(async () => {
      hint('omp-1', 'Perbaiki tombol stop');
    });

    expect(harness.holder.api?.titleHint('omp-1')).toBe('Perbaiki tombol stop');
    expect(harness.holder.api?.titleHint('omp-2')).toBeUndefined();
    expect(harness.holder.api?.titleHint(null)).toBeUndefined();
    harness.server.stop();
  });

  test('ignores a blank hint and drops one once the session is listed', async () => {
    const harness = await mountProvider();
    await act(async () => {
      hint('a', '   ');
    });
    expect(harness.holder.api?.titleHint('a')).toBeUndefined();

    await act(async () => {
      hint('a', 'sent text');
    });
    expect(harness.holder.api?.titleHint('a')).toBe('sent text');

    // The session is in the structure, so the placeholder is not drawn and the
    // hint has nothing left to stand in for. A status delta is enough: the
    // cleanup runs on every snapshot, and the structure already carries `a`.
    await harness.push(undefined, statusBody('stream'));
    expect(harness.holder.api?.titleHint('a')).toBeUndefined();
    harness.server.stop();
  });
});
