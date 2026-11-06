/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The versions store must RE-READ after an update.
 *
 * The reported bug: press Update, the install runs, and the button is still
 * there — plus the row still shows the old version. The cause was one early
 * return: `loadVersions(false)` skipped the whole read when `loaded` was already
 * true, so the update's own refresh did nothing.
 *
 * `refresh()` is therefore a DIFFERENT operation from `reload(force)`:
 *
 *  - `refresh` re-reads the rows (an update already knows the new number);
 *  - `reload(true)` also bypasses the server's registry cache, which costs one
 *    request per npm harness and belongs to the explicit "Check" button.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import {
  resetHarnessVersions,
  useHarnessVersions,
} from '@/client/hooks/models/use-harness-versions';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

const realFetch = Bun.fetch;
let container: HTMLElement;
let calls: string[] = [];
let payload: { harnesses: unknown[] } = { harnesses: [] };

beforeEach(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
  resetHarnessVersions();
  container = document.createElement('div');
  document.body.appendChild(container);
  calls = [];
  payload = { harnesses: [] };
  (globalThis as unknown as Record<string, unknown>).fetch = async (input: unknown) => {
    calls.push(String(input));
    return new Response(JSON.stringify(payload), { status: 200 });
  };
});

afterEach(() => {
  render(null, container);
  container.remove();
  restoreDomGlobals();
  (globalThis as unknown as Record<string, unknown>).fetch = realFetch;
  resetHarnessVersions();
});

/** Mount a consumer and hand back what it last rendered. */
function mountConsumer(): { read: () => ReturnType<typeof useHarnessVersions> } {
  const box = { latest: null as ReturnType<typeof useHarnessVersions> | null };
  function Consumer() {
    box.latest = useHarnessVersions();
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

/** Let the stub's promise chain settle — microtasks, not a timer. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/**
 * One row as the route answers it. The parts are per-install — the adapter and the
 * CLI move independently — so the store is handed the same shape the wire carries.
 */
function row(updateAvailable: boolean) {
  return {
    id: 'claude', label: 'claude', kind: 'npm', installed: true,
    agent: { version: updateAvailable ? '0.100.0' : '0.101.0', latest: '0.101.0', updateAvailable },
    cli: null,
    updateAvailable, note: null, command: null,
  };
}

describe('versions store refresh', () => {
  test('refresh() re-reads after an update instead of doing nothing', async () => {
    payload = { harnesses: [row(true)] };
    const consumer = mountConsumer();
    await flush();
    expect(consumer.read().rows[0].updateAvailable).toBe(true);

    // What the server answers once the install landed.
    payload = { harnesses: [row(false)] };
    await act(async () => {
      consumer.read().refresh();
    });
    await flush();

    // The reported defect: without this the row kept offering Update.
    expect(consumer.read().rows[0].updateAvailable).toBe(false);
    expect(calls.filter((url) => url.includes('/api/harness/versions'))).toHaveLength(2);
  });

  test('refresh() does NOT force the registry cache', async () => {
    payload = { harnesses: [row(true)] };
    const consumer = mountConsumer();
    await flush();
    await act(async () => {
      consumer.read().refresh();
    });
    await flush();

    // Only `reload(true)` may spend the extra registry read.
    expect(calls.some((url) => url.includes('force=1'))).toBe(false);
  });

  test('reload(true) is the one that asks the registry again', async () => {
    payload = { harnesses: [row(true)] };
    const consumer = mountConsumer();
    await flush();
    await act(async () => {
      consumer.read().reload(true);
    });
    await flush();

    expect(calls.some((url) => url.includes('force=1'))).toBe(true);
  });

  test('a second mount joins the first read rather than asking twice', async () => {
    payload = { harnesses: [row(true)] };
    const first = mountConsumer();
    const second = mountConsumer();
    await flush();

    expect(first.read().rows).toHaveLength(1);
    expect(second.read().rows).toHaveLength(1);
    expect(calls.filter((url) => url.includes('/api/harness/versions'))).toHaveLength(1);
  });
});
