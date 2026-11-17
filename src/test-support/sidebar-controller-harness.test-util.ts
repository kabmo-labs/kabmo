/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The mounted sidebar controller, shared by the two suites that exercise it.
 *
 * The row suite and the folder-open suite each start a real realtime server and
 * mount the real provider; duplicating that setup would let the two drift, and
 * one file would then assert against a harness the other no longer runs.
 *
 * `bun test` shares one module registry across files, so the pending store is
 * process state: every suite clears it before each case. The mounted tree is
 * unmounted (not detached) after each case, because its socket listeners and
 * the container's Preact tree outlive the DOM globals otherwise.
 */

import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import {
  useSessionSidebarController,
  type SessionSidebarController,
} from '@/client/hooks/chat/omp/session-sidebar-controller';
import { SidebarDataProvider } from '@/client/hooks/chat/omp/session-list';
import { resetRealtimeClient } from '@/shared/lib/realtime/client';
import { TOPIC_SIDEBAR, TOPIC_SIDEBAR_STATUS } from '@/shared/lib/realtime/protocol';
import { startRealtimeTestServer, type RealtimeTestServer } from '@/test-support/realtime-server';
import type { TopicResolver } from '@/server/lib/realtime/hub.server';
import { installDomGlobals, pristineWebSocket } from '@/test-support/pristine-globals';
import type { SidebarPayload, SidebarStatusPayload } from '@/shared/types/realtime';
import type { WorkspaceFolderData } from '@/shared/types';

let container: HTMLElement | undefined;

export interface ControllerHarness {
  server: RealtimeTestServer;
  holder: { api: SessionSidebarController | null };
  /** Re-point the URL the controller reads (`?sessionId=`). */
  setUrl: (search: string) => Promise<void>;
}

/** The seeded structure: one folder holding one real session. */
export function sidebarStructureBody(): SidebarPayload {
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

/**
 * Mount the real controller under the real provider.
 *
 * `options` is left EMPTY by default, which is exactly the phone's call — the
 * mobile sidebar passes none — so a case mounted that way proves the row is
 * not something a layout has to ask for.
 */
export async function mountSidebarController(
  url = '?sessionId=real-1',
  options: Parameters<typeof useSessionSidebarController>[1] = {},
): Promise<ControllerHarness> {
  const server = await startRealtimeTestServer(new Map<string, TopicResolver>([
    [TOPIC_SIDEBAR, async () => sidebarStructureBody()],
    [TOPIC_SIDEBAR_STATUS, async (): Promise<SidebarStatusPayload> => ({})],
  ]));
  installDomGlobals(new Window({ url: `http://127.0.0.1:${server.port}/` }));
  (globalThis as unknown as Record<string, unknown>).WebSocket = pristineWebSocket;
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

/** Unmount the tree and forget the realtime client. One call per case. */
export function disposeSidebarController(): void {
  if (container) render(null, container);
  container?.remove();
  container = undefined;
  resetRealtimeClient();
}

/** Every session id the rendered list carries, across all folders. */
export function renderedSessionIds(api: SessionSidebarController | null): string[] {
  return (api?.processedFolders ?? []).flatMap((folder: WorkspaceFolderData) => (
    (folder.sessions ?? []).map((session) => String(session.id))
  ));
}
