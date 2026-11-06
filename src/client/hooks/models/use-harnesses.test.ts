/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The harness catalog is ONE store, shared by every surface that reads it.
 *
 * Two mounted surfaces ask `GET /api/harness` at the same time — the composer's
 * tab strip and Settings → Harnesses — and each used to hold its own
 * `useState`. The probes therefore lived in whichever instance ran them:
 * pressing **Check status** on `opencode` wrote its model list into the SETTINGS
 * copy and the picker went on saying "This harness has not reported its models
 * yet". Measured in a browser: probe in Settings, switch to the composer, zero
 * rows; reload the page, 96 rows — the answer only LOOKED fresh because the
 * server had cached it and the reload re-read the cache.
 *
 * So the assertions are about SHARING, not about fetching:
 *
 *  - a probe made from one mount is visible from another, with no reload;
 *  - one catalog read serves every mount (one request, not one per hook call);
 *  - a mount that arrives after the read still sees the catalog.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { resetHarnessesStore, useHarnesses } from '@/client/hooks/models/use-harnesses';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

const OPENCODE_UNPROBED = {
  id: 'opencode',
  label: 'opencode',
  transport: 'acp',
  canLaunch: true,
  probe: null,
};

const OPENCODE_PROBED = {
  harness: 'opencode',
  capabilities: {
    configModel: 96, configThinking: 6, configMode: 4, modeValues: ['build', 'plan'],
    loadSession: true, listSessions: true, forkSession: true, deleteSession: true,
    resumeSession: true, closeSession: true, hasUsage: false, hasPlan: false, steerMode: null,
  },
  models: [{ value: 'command-code/deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash' }],
  thinking: [],
  modes: [],
  probedAt: Date.now(),
};

/** The runner's own `fetch`, captured at module load — before this file's first
 *  stub exists — so teardown puts back the real one. `Bun.fetch` is the stable
 *  handle; a local `const` would capture whatever the PREVIOUS suite left. */
const realFetch = Bun.fetch;

let container: HTMLElement;
let calls: string[] = [];

beforeEach(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
  // The store is module state on purpose (that is the fix); a test file starts
  // it cold so each case states its own preconditions.
  resetHarnessesStore();
  container = document.createElement('div');
  document.body.append(container);
  calls = [];
});

afterEach(() => {
  render(null, container);
  container.remove();
  restoreDomGlobals();
  (globalThis as unknown as Record<string, unknown>).fetch = realFetch;
});

/** A `fetch` that answers the catalog and records every request. */
function stubFetch(): void {
  (globalThis as unknown as Record<string, unknown>).fetch = async (input: unknown, init?: { method?: string }) => {
    const url = String(input);
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (init?.method === 'POST') {
      return new Response(JSON.stringify({ probe: OPENCODE_PROBED }), { status: 200 });
    }
    return new Response(JSON.stringify({ harnesses: [OPENCODE_UNPROBED] }), { status: 200 });
  };
}

/**
 * Mount one `useHarnesses()` consumer and hand back the value it last RENDERED.
 *
 * Read from render output, not from a call: a hook can only be called while a
 * component is rendering, and the store's whole job is to make that render run
 * again when a probe lands.
 */
function mountConsumer(): { read: () => ReturnType<typeof useHarnesses> } {
  const box = { latest: null as ReturnType<typeof useHarnesses> | null };
  function Consumer() {
    box.latest = useHarnesses();
    return null;
  }
  const host = document.createElement('div');
  container.appendChild(host);
  // Inside `act`: the hook's effect fires the stub `fetch`, and Preact needs the
  // scheduler flushed for the resulting state to reach a render.
  act(() => render(h(Consumer, {}), host));
  return {
    read: () => {
      if (!box.latest) throw new Error('consumer did not render');
      return box.latest;
    },
  };
}

/**
 * Let the stub's promises settle.
 *
 * Awaiting a resolved promise, not a timer: the store's `fetch` stub answers
 * immediately, so the pending work IS the microtask queue. A sleep here would
 * buy the same result at a fixed latency on every run and hide which condition
 * the case actually waited for.
 */
async function flush(): Promise<void> {
  // `act` with an async callback drains the microtask queue between renders, so
  // the stub's promise chain (fetch → json → emit → setState) lands before the
  // assertions read. No timer: nothing here waits on wall-clock time.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useHarnesses is one shared store', () => {
  test('two mounts share ONE catalog read', async () => {
    stubFetch();
    const first = mountConsumer();
    const second = mountConsumer();
    await flush();

    expect(first.read().harnesses).toHaveLength(1);
    expect(second.read().harnesses).toHaveLength(1);
    // The second mount joined the in-flight read rather than firing its own.
    expect(calls.filter((call) => call.startsWith('GET'))).toHaveLength(1);
  });

  test('a probe from one mount is visible from the other, with no reload', async () => {
    // This is the bug, exactly: Settings probed, the picker never learned.
    stubFetch();
    const settings = mountConsumer();
    const picker = mountConsumer();
    await flush();
    expect(picker.read().harnesses[0].probe).toBeNull();

    await act(async () => {
      await settings.read().probe('opencode');
    });

    // Both surfaces see the 96 models, and the picker did not re-fetch to get
    // them — the store pushes them.
    expect(picker.read().harnesses[0].probe?.capabilities.configModel).toBe(96);
    expect(settings.read().harnesses[0].probe?.capabilities.configModel).toBe(96);
  });

  test('a mount that arrives AFTER the read still sees the catalog', async () => {
    stubFetch();
    const early = mountConsumer();
    await flush();

    const late = mountConsumer();
    await flush();
    expect(late.read().harnesses).toHaveLength(1);
    expect(early.read().error).toBeNull();
  });

  test('a failed read is reported, never papered over with an empty list claim', async () => {
    (globalThis as unknown as Record<string, unknown>).fetch = async () => new Response('nope', { status: 500 });
    const consumer = mountConsumer();
    await flush();
    expect(consumer.read().error).toContain('500');
    // A failed read REPORTS; it does not claim "no harnesses installed".
    expect(consumer.read().isLoading).toBe(false);
  });
});
