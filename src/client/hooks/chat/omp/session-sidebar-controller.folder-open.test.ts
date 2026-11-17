/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The sidebar controller's folder-open rule, split from the pending-row suite
 * so each file stays under the 350-line ceiling.
 *
 * A row the user must see opens its folder: a run in flight, and a new chat
 * waiting for its transcript. The open is DRAWN immediately and WRITTEN once,
 * because the server owns the persisted expansion and a write per structure
 * push would be a request storm on every tool call.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'preact/test-utils';

import { listPendingSessions, releasePendingSession, startPendingSession } from '@/client/hooks/chat/omp/pending-sessions';
import { TOPIC_SIDEBAR, TOPIC_SIDEBAR_STATUS } from '@/shared/lib/realtime/protocol';
import { restoreDomGlobals } from '@/test-support/pristine-globals';
import type { SidebarPayload, SidebarStatusPayload } from '@/shared/types/realtime';
import {
  disposeSidebarController,
  mountSidebarController,
  sidebarStructureBody,
  type ControllerHarness,
} from '@/test-support/sidebar-controller-harness.test-util';

afterEach(() => disposeSidebarController());

beforeEach(() => {
  for (const entry of listPendingSessions()) releasePendingSession(entry.id);
});

afterAll(() => {
  restoreDomGlobals();
});

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
async function publishRun(harness: ControllerHarness): Promise<void> {
  await act(async () => {
    harness.server.publish(TOPIC_SIDEBAR_STATUS, { 'real-1': { streamStatus: 'stream' } });
    await harness.server.waitForTopic<SidebarStatusPayload>(
      TOPIC_SIDEBAR_STATUS,
      (value) => value?.['real-1']?.streamStatus === 'stream',
    );
  });
  await flush();
}

describe('a folder opens when a row inside it needs to be seen', () => {
  test('a run in flight opens its collapsed folder and stores the flag', async () => {
    const harness = await mountSidebarController('?sessionId=real-1');
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
    const harness = await mountSidebarController('?sessionId=real-1');
    const writes = stubToggleWrites();
    try {
      await publishRun(harness);
      expect(writes.toggles).toHaveLength(1);

      // A tool call republishes the structure mid-run. A payload that DIFFERS
      // (the rename) is what makes the client re-render the list, so the effect
      // really is given a chance to write again.
      await act(async () => {
        harness.server.publish(TOPIC_SIDEBAR, {
          folders: [{ ...sidebarStructureBody().folders[0], name: 'ws renamed' }],
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
    const harness = await mountSidebarController('?sessionId=real-1');
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
