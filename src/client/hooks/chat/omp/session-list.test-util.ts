/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Shared harness for the `SidebarDataProvider` suites.
 *
 * Driven through a REAL server and a real socket rather than a stubbed fetch,
 * because what the provider does is merge three topics and apply the optimistic
 * overlays — the parts that used to be "does it re-read". A stubbed socket
 * would only prove the fake's timing.
 *
 * Split out when the suites together crossed the repo's per-file ceiling: the
 * harness is setup, and the rules under test belong in their own files.
 */

import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { SidebarDataProvider, useSidebarData } from '@/client/hooks/chat/omp/session-list';
import type { SidebarDataHandle } from '@/client/hooks/chat/omp/session-list';
import { resetRealtimeClient } from '@/shared/lib/realtime/client';
import { TOPIC_SIDEBAR, TOPIC_SIDEBAR_ACTIVITY, TOPIC_SIDEBAR_STATUS } from '@/shared/lib/realtime/protocol';
import { startRealtimeTestServer, type RealtimeTestServer } from '@/test-support/realtime-server';
import type { TopicResolver } from '@/server/lib/realtime/hub.server';
import { installDomGlobals, pristineWebSocket } from '@/test-support/pristine-globals';
import type { SidebarActivityPayload, SidebarPayload, SidebarStatusPayload } from '@/client/hooks/chat/omp/session-list';
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

/** Unmount and drop the socket between cases. Each suite calls this in its own `afterEach`. */
export function teardownProvider(): void {
  if (container) render(null, container);
  container?.remove();
  container = undefined;
  resetRealtimeClient();
}

export type Status = 'stream' | 'finish' | 'abort';

/** A structure payload carrying one session, `a`. */
export function structureBody(): SidebarPayload {
  return {
    folders: [{ id: 1, name: 'ws', isExpanded: true, hasMore: false, totalSessions: 1, sessions: [{ id: 'a', folder_id: 1, title: 'A' }] }],
    isMock: false,
  };
}

/** The volatile map for `a`. */
export function statusBody(status?: Status): SidebarStatusPayload {
  return status ? { a: { streamStatus: status } } : {};
}

/** The live-activity map: empty until a case publishes one. */
export function activityBody(): SidebarActivityPayload {
  return {};
}

/** One folder holding the given sessions, shaped only as far as the strip reads it. */
export function folders(sessions: Array<{ id: string; streamStatus?: Status }>): WorkspaceFolderData[] {
  return [{ id: 1, name: 'ws', sessions }] as unknown as WorkspaceFolderData[];
}

/** The status the provider currently renders for session `a`. */
export function renderedStatus(api: SidebarDataHandle | null): Status | undefined {
  return api?.folders[0]?.sessions?.[0].streamStatus;
}

/**
 * Let Preact's queued effects run.
 *
 * A microtask drain, and deliberately nothing more: the socket's own progress
 * is awaited through the harness, so this only has to flush the render a
 * received frame queued.
 */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

export interface Harness {
  server: RealtimeTestServer;
  holder: { api: SidebarDataHandle | null };
  /** Republish any of the three sidebar topics from a fresh body. */
  push: (structure?: SidebarPayload, status?: SidebarStatusPayload, activity?: SidebarActivityPayload) => Promise<void>;
}

/** Mount the real provider against a real realtime server. */
export async function mountProvider(): Promise<Harness> {
  const server = await startRealtimeTestServer(new Map<string, TopicResolver>([
    [TOPIC_SIDEBAR, async () => structureBody()],
    [TOPIC_SIDEBAR_STATUS, async () => statusBody()],
    [TOPIC_SIDEBAR_ACTIVITY, async () => activityBody()],
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
    push: async (structure, status, activity) => {
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
      if (activity) {
        server.publish(TOPIC_SIDEBAR_ACTIVITY, activity);
        await server.waitForTopic(TOPIC_SIDEBAR_ACTIVITY, (value) => JSON.stringify(value) === JSON.stringify(activity));
      }
      await act(async () => {
        await flush();
      });
    },
  };
}

/** Run `body` with Preact's effects flushed around it. */
export async function withAct(body: () => void | Promise<void>): Promise<void> {
  await act(async () => {
    await body();
    await flush();
  });
}
