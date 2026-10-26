/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The find bar's recent queries.
 *
 * Newest first, no duplicates, bounded — and only queries that were actually USED, which
 * is why `remember` is called from the bar's close rather than from every keystroke. A
 * half-written regex that never ran is noise in a list whose value is that each entry is
 * something you searched for.
 */

import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { FIND_HISTORY_LIMIT, useFindHistory, type FindHistory } from '@/client/hooks/editor/find-history';
import { forgetSession } from '@/shared/lib/workspace/session-state/store';
import type { ComponentChildren } from 'preact';
import type { ComponentType } from 'preact/compat';

const SESSION = 'find-history-test';
const DOM_GLOBALS = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent'] as const;
const native: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};
const win = new Window({ url: 'http://localhost' });
for (const key of DOM_GLOBALS) {
  const target = globalThis as unknown as Record<string, unknown>;
  native[key] = target[key];
  target[key] = (win as unknown as Record<string, unknown>)[key];
}

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) target[key] = native[key];
});

afterEach(() => {
  forgetSession(SESSION);
});

/**
 * Mounted through the REAL session-state provider: `useFindHistory` persists through
 * `useSessionState`, and a local stub would not exercise the store the history actually
 * lives in.
 */
let SessionStateProvider: ComponentType<{ sessionId: string; children: ComponentChildren }>;

async function mount(): Promise<{ api: () => FindHistory; unmount: () => void }> {
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => ({ sessionId: SESSION, state: {} }),
    text: async () => JSON.stringify({ sessionId: SESSION, state: {} }),
  })) as unknown as typeof fetch;
  const provider = await import('@/client/components/common/session-state-provider/index');
  SessionStateProvider = provider.SessionStateProvider as typeof SessionStateProvider;

  let slot: FindHistory | null = null;
  function Probe() {
    slot = useFindHistory();
    return null;
  }
  const host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    render(h(SessionStateProvider, { sessionId: SESSION, children: h(Probe, {}) }), host);
  });
  for (let turn = 0; turn < 12; turn++) {
    await act(async () => { for (let inner = 0; inner < 8; inner++) await Promise.resolve(); });
  }
  return {
    api: () => {
      if (!slot) throw new Error('not mounted');
      return slot;
    },
    unmount: () => render(null, host),
  };
}

describe('useFindHistory', () => {
  test('starts empty', async () => {
    const { api, unmount } = await mount();
    expect(api().entries).toEqual([]);
    unmount();
  });

  test('records newest first', async () => {
    const { api, unmount } = await mount();
    act(() => api().remember('alpha'));
    act(() => api().remember('beta'));
    expect(api().entries).toEqual(['beta', 'alpha']);
    unmount();
  });

  test('re-searching an entry moves it to the front instead of duplicating it', async () => {
    const { api, unmount } = await mount();
    act(() => api().remember('alpha'));
    act(() => api().remember('beta'));
    act(() => api().remember('alpha'));
    expect(api().entries).toEqual(['alpha', 'beta']);
    unmount();
  });

  test('an empty or whitespace query is not recorded', async () => {
    const { api, unmount } = await mount();
    act(() => api().remember('   '));
    act(() => api().remember(''));
    expect(api().entries).toEqual([]);
    unmount();
  });

  test('trims before comparing, so " alpha " and "alpha" are one entry', async () => {
    const { api, unmount } = await mount();
    act(() => api().remember(' alpha '));
    act(() => api().remember('alpha'));
    expect(api().entries).toEqual(['alpha']);
    unmount();
  });

  test('is bounded, dropping the oldest', async () => {
    const { api, unmount } = await mount();
    for (let index = 0; index < FIND_HISTORY_LIMIT + 5; index++) {
      act(() => api().remember(`query-${index}`));
    }
    expect(api().entries).toHaveLength(FIND_HISTORY_LIMIT);
    expect(api().entries[0]).toBe(`query-${FIND_HISTORY_LIMIT + 4}`);
    expect(api().entries).not.toContain('query-0');
    unmount();
  });
});
