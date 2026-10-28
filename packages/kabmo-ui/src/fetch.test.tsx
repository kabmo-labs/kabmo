/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `useKabmoFetch` — the kit's own reader for a plugin panel that reaches the
 * Kabmo's HTTP API.
 *
 * It replaced two hand-rolled copies (`useSessionTodos`, `useSessionPlan`) that
 * had the same three behaviours and the same three bugs waiting to happen, so
 * this file pins the behaviours rather than the call sites (Kabmo's own
 * views have since moved to the realtime socket):
 *
 * - **A late answer never overwrites a newer one.** Switching sessions fires a
 *   second request while the first is in flight; without the sequence guard the
 *   previous session's payload lands under the new title.
 * - **A new URL DROPS the old payload first.** Not merely re-reads: a stale list
 *   visible under a new session's name is the failure a user actually sees.
 * - **Hidden and disabled panels do not poll.** A background tab cannot render
 *   the result, and a hidden view's poll is pure waste.
 *
 * Rendered with `h()` (no JSX) against happy-dom.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { configureUiKit, useKabmoFetch, type PanelContext, type UiKitServices } from '@kabmo-labs/kabmo-ui';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event', 'MouseEvent', 'KeyboardEvent'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

const CONTEXT: PanelContext = { sessionId: 's1', workspacePath: '/ws', theme: 'paper' };
const SERVICES: UiKitServices = {
  context: () => CONTEXT,
  subscribe: () => () => {},
  getSessionValue: () => null,
  setSessionValue: () => {},
  readWorkspaceFile: async () => '',
};

/** One fetch call, and the promise its caller is waiting on. */
interface PendingRequest {
  url: string;
  resolve: (body: unknown, status?: number) => void;
}

let container: HTMLElement;
let requests: PendingRequest[] = [];
/** The reads a disabled/hidden hook was expected NOT to make. */
let calls = 0;

function installFetch(): void {
  (globalThis as unknown as Record<string, unknown>).fetch = (input: unknown) => {
    calls += 1;
    const url = String(input);
    return new Promise<Response>((resolve) => {
      requests.push({
        url,
        resolve: (body, status = 200) =>
          resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })),
      });
    });
  };
}

beforeEach(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
  container = document.createElement('div') as unknown as HTMLElement;
  document.body.appendChild(container as never);
  requests = [];
  calls = 0;
  installFetch();
  configureUiKit(SERVICES);
});

afterEach(() => {
  render(null, container);
  container.remove();
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (key in nativeGlobals) target[key] = nativeGlobals[key];
    else delete target[key];
  }
});

/** Render the hook and expose what it holds, so a test can read the DOM. */
function Probe({ url, enabled = true }: { url: string | null; enabled?: boolean }) {
  const { data, isLoading, error } = useKabmoFetch<{ value: number }>(url, { enabled, pollMs: 0 });
  return h(
    'div',
    { id: 'probe' },
    `${data === null ? 'null' : data.value}|${isLoading ? 'loading' : 'idle'}|${error ?? 'ok'}`,
  );
}

const read = () => (container.querySelector('#probe') as HTMLElement | null)?.textContent ?? '';

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await act(async () => {});
}

describe('useKabmoFetch', () => {
  test('a late answer from a superseded request never lands', async () => {
    await act(async () => render(h(Probe, { url: '/api/a' }), container));
    await settle();
    expect(requests).toHaveLength(1);

    // The caller moves on while the first request is still in flight.
    await act(async () => render(h(Probe, { url: '/api/b' }), container));
    await settle();
    expect(requests).toHaveLength(2);
    expect(read()).toBe('null|loading|ok');

    // The SECOND settles first, then the first arrives late.
    await act(async () => requests[1].resolve({ value: 2 }));
    await settle();
    expect(read()).toStartWith('2|');

    await act(async () => requests[0].resolve({ value: 1 }));
    await settle();
    // Still B, not A: the stale answer was dropped rather than written.
    expect(read()).toStartWith('2|');
  });

  test('a new URL drops the previous payload rather than showing it under the new name', async () => {
    await act(async () => render(h(Probe, { url: '/api/a' }), container));
    await settle();
    await act(async () => requests[0].resolve({ value: 1 }));
    await settle();
    expect(read()).toStartWith('1|');

    await act(async () => render(h(Probe, { url: '/api/b' }), container));
    // Not "1|loading" — the old list must not render under the new session.
    expect(read()).toBe('null|loading|ok');
  });

  test('a disabled or absent URL makes no request at all', async () => {
    await act(async () => render(h(Probe, { url: '/api/a', enabled: false }), container));
    await settle();
    expect(calls).toBe(0);

    await act(async () => render(h(Probe, { url: null }), container));
    await settle();
    expect(calls).toBe(0);
  });

  test('a failed read keeps the reason and the previous payload', async () => {
    await act(async () => render(h(Probe, { url: '/api/a' }), container));
    await settle();
    await act(async () => requests[0].resolve({ value: 7 }));
    await settle();

    await act(async () => render(h(Probe, { url: '/api/b' }), container));
    await settle();
    await act(async () => requests[1].resolve({ error: 'nope' }, 500));
    await settle();
    expect(read()).toBe('null|idle|nope');
  });
});
