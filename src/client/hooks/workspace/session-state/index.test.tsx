/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A per-session slot is never painted under another session's id.
 *
 * The reported defect: a fresh chat opened with the `Files` right-panel tab
 * already in its strip, on both the phone and the desktop. The strip mirrors its
 * selection into `layout.activeRightPanel`, and a switch renders once before the
 * new session's blob lands — with the OLD session's local copy still in the
 * hook. That commit wrote the old strip into the new session, where the (empty)
 * blob then merged under it.
 *
 * So the claim is about the RENDER, not the store: after a switch, no commit may
 * expose the previous session's value under the new id.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { SessionStateProvider } from '@/client/components/common/session-state-provider/index';
import { useSessionState } from '@/client/hooks/workspace/session-state';
import { useSessionStateContext } from '@/client/hooks/workspace/session-state/context';
import {
  getSessionState,
  hydrateSession,
  resetSessionStateStore,
} from '@/shared/lib/workspace/session-state/store';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'KeyboardEvent'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};
const nativeFetch = Bun.fetch;

let container: HTMLElement;
/** Every commit's `(session, value)`, so a stale one cannot hide behind the last. */
let renders: Array<{ session: string; panel: string }> = [];

function Probe() {
  const { sessionId } = useSessionStateContext();
  const [panel] = useSessionState<string>('layout.activeRightPanel', 'files');
  renders.push({ session: sessionId, panel });
  return h('div', null, panel);
}

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
  // Answer with the SESSION's own entry, so a load landing mid-test cannot
  // adopt an empty blob over the value `hydrateSession` seeded.
  target.fetch = async (input: unknown, init?: { method?: string }) => {
    const method = init?.method ?? 'GET';
    const sessionId = String(input).split('/sessions/')[1]?.split('/')[0] ?? 'x';
    if (method === 'POST') return new Response(JSON.stringify({ success: true }), { status: 200 });
    return new Response(
      JSON.stringify({ sessionId, state: { ...(getSessionState(sessionId) ?? {}) } }),
      { status: 200 },
    );
  };
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (nativeGlobals[key] === undefined) delete target[key];
    else target[key] = nativeGlobals[key];
  }
  target.fetch = nativeFetch;
});

beforeEach(() => {
  resetSessionStateStore();
  renders = [];
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
});

/** Render the provider on a session id and drain the load's promise chain. */
async function show(sessionId: string) {
  await act(async () => {
    render(h(SessionStateProvider, { sessionId, children: h(Probe, null) }), container);
  });
  for (let i = 0; i < 20; i += 1) await act(async () => {});
}

describe('useSessionState across a session switch', () => {
  test('the previous session value is never rendered under the new id', async () => {
    hydrateSession('s-prev', { 'layout.activeRightPanel': 'git' });
    await show('s-prev');
    expect(renders.at(-1)).toEqual({ session: 's-prev', panel: 'git' });

    renders = [];
    await show('s-fresh');

    // The switch commit itself used to carry `git` — the old chat's pick — and
    // every mirror-on-render then wrote it into the fresh session.
    expect(renders.filter((r) => r.session === 's-fresh' && r.panel !== 'files')).toEqual([]);
    expect(renders.at(-1)).toEqual({ session: 's-fresh', panel: 'files' });
  });

  test('a session with its own stored value shows that value, not the previous one', async () => {
    hydrateSession('s-prev', { 'layout.activeRightPanel': 'git' });
    hydrateSession('s-owns', { 'layout.activeRightPanel': 'todo' });
    await show('s-prev');

    renders = [];
    await show('s-owns');
    expect(renders.at(-1)).toEqual({ session: 's-owns', panel: 'todo' });
  });

  test('a write during the switch persists under the new id', async () => {
    hydrateSession('s-prev', { 'layout.activeRightPanel': 'git' });
    hydrateSession('s-write', {});
    await show('s-prev');

    function Writer() {
      const [, setPanel] = useSessionState<string>('layout.activeRightPanel', 'files');
      return h('button', { onClick: () => setPanel('terminal') }, 'pick');
    }

    await act(async () => {
      render(
        h(SessionStateProvider, { sessionId: 's-write', children: h(Writer, null) }),
        container,
      );
    });
    for (let i = 0; i < 20; i += 1) await act(async () => {});
    (container.querySelector('button') as HTMLButtonElement).click();
    await act(async () => {});

    expect(getSessionState('s-write')?.['layout.activeRightPanel']).toBe('terminal');
    expect(getSessionState('s-prev')?.['layout.activeRightPanel']).toBe('git');
  });
});
