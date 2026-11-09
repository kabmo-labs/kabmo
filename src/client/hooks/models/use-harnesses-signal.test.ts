/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A provider write republishes the `models` topic, and the harness catalog is
 * stale in exactly the same way: the server re-probed the ACP harnesses on that
 * write. The hook therefore re-reads `GET /api/harness` when the topic fires —
 * without this, the composer picker kept the pre-write probe until a reload.
 *
 * A real listener on a real socket, because the bug is frame delivery, not the
 * fetch: a stubbed socket would only prove the fake's timing.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { resetHarnessesStore } from '@/client/hooks/models/harness-catalog';
import { useHarnesses } from '@/client/hooks/models/use-harnesses';
import type { HarnessesController } from '@/client/hooks/models/use-harnesses-controller';
import { TOPIC_MODELS } from '@/shared/lib/realtime/protocol';
import { resetRealtimeClient } from '@/shared/lib/realtime/client';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import { startRealtimeTestServer, type RealtimeTestServer } from '@/test-support/realtime-server';

const UNPROBED = { id: 'omp-acp', label: 'omp ACP', transport: 'acp', canLaunch: true, probe: null };
const PROBED = {
  id: 'omp-acp',
  label: 'omp ACP',
  transport: 'acp',
  canLaunch: true,
  probe: {
    harness: 'omp-acp',
    capabilities: {
      configModel: 2, configThinking: 0, configMode: 0, modeValues: [],
      loadSession: true, listSessions: true, forkSession: true, deleteSession: true,
      resumeSession: true, closeSession: true, hasUsage: false, hasPlan: false, steerMode: null,
    },
    models: [
      { value: 'minimax/MiniMax-M2', name: 'MiniMax M2' },
      { value: 'kimi/kimi-k2', name: 'Kimi K2' },
    ],
    thinking: [],
    modes: [],
    probedAt: Date.now(),
  },
};

const realFetch = Bun.fetch;
let server: RealtimeTestServer;
let container: HTMLElement;
let catalogReads = 0;
/** The server's answer changed only when the write lands. */
let written = false;

beforeEach(async () => {
  server = await startRealtimeTestServer(new Map([[TOPIC_MODELS, async () => ({ modelList: [] })]]));
  installDomGlobals(new Window({ url: `http://127.0.0.1:${server.port}` }));
  resetHarnessesStore();
  catalogReads = 0;
  written = false;
  (globalThis as unknown as Record<string, unknown>).fetch = async (input: unknown) => {
    const url = String(input);
    if (!url.includes('/api/harness')) return new Response('{}', { status: 200 });
    catalogReads += 1;
    const body = { harnesses: [written ? PROBED : UNPROBED], configs: {}, providerSupport: {} };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
  resetRealtimeClient();
  server.stop();
  restoreDomGlobals();
  (globalThis as unknown as Record<string, unknown>).fetch = realFetch;
});

function mount(): { read: () => HarnessesController } {
  const box = { latest: null as HarnessesController | null };
  function Consumer() {
    box.latest = useHarnesses();
    return null;
  }
  const host = document.createElement('div');
  container.appendChild(host);
  act(() => render(h(Consumer, {}), host));
  return {
    read: () => {
      if (!box.latest) throw new Error('consumer did not render');
      return box.latest;
    },
  };
}

describe('the harness catalog follows the models topic', () => {
  test('a models-changed frame re-reads the catalog and shows the new probe', async () => {
    const consumer = mount();
    await act(async () => {});
    await server.waitForTopic(TOPIC_MODELS, (value) => value !== null);
    expect(consumer.read().harnesses[0]?.probe).toBeNull();
    // Mounting costs one read; the subscription's opening snapshot costs the
    // second. That snapshot is the same catalog, so the probe is still absent.
    expect(catalogReads).toBe(2);

    written = true;
    server.publish(TOPIC_MODELS, { modelList: [{ value: 'minimax/MiniMax-M2' }] });
    // Wait on the client's own notification: the delta is a socket task, so a
    // microtask drain alone could assert before the frame is even decoded.
    await server.waitForTopic<{ modelList: { value: string }[] }>(
      TOPIC_MODELS,
      (value) => value?.modelList.length === 1,
    );
    // The subscriber's fetch starts from that notification; drain until the
    // store's render reflects the post-write answer.
    for (let i = 0; i < 20 && !consumer.read().harnesses[0]?.probe; i += 1) await act(async () => {});
    await act(async () => {});

    expect(catalogReads).toBeGreaterThan(2);
    expect(consumer.read().harnesses[0]?.probe?.models).toHaveLength(2);
  });
});
