/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Per-session openness for a tool call's body.
 *
 * Two properties carry the feature. The state must SURVIVE a remount (that is
 * the whole reason it moved out of the section's `useState`), and the FIRST
 * toggle of an untouched call must flip the default it is currently rendering —
 * an auto-opened error card that needed two clicks to close would be worse than
 * the state it replaced.
 *
 * Mounted against a real `SessionStateProvider`, with `fetch` stubbed to answer
 * the session blob, so restore runs through the same path the app uses and the
 * test waits on that promise instead of on a clock.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { useState } from 'preact/hooks';
import { act } from 'preact/test-utils';
import { useToolOpenState, TOOL_OPEN_STATE_KEY, type ToolOpenState } from '@/client/hooks/chat/timeline/tool-open';
import { SessionStateProvider } from '@/client/components/common/session-state-provider';
import { clearSessionKey, setSessionKey } from '@/shared/lib/workspace/session-state/store';
import type { ToolCallData } from '@/shared/types/chat';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'KeyboardEvent'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};
let container: HTMLElement;

/** The blob the provider's load will receive. */
let servedState: Record<string, unknown> = {};
const originalFetch = globalThis.fetch;

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
  // The provider loads `/api/sessions/:id/state`; answering it in-process keeps
  // the test off the network and off the clock.
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes('/api/sessions/') && url.includes('/state') ? { state: servedState } : {};
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (nativeGlobals[key] === undefined) delete target[key];
    else target[key] = nativeGlobals[key];
  }
});

beforeEach(() => {
  servedState = {};
  clearSessionKey(SESSION, TOOL_OPEN_STATE_KEY);
});

function tool(id: string, partial: Partial<ToolCallData> = {}): ToolCallData {
  return { id, type: 'bash', name: 'bash', title: 'bash', ...partial } as ToolCallData;
}

/** Mount a probe that exposes the hook's surface, and return it. */
async function mountHook(tools: ToolCallData[], autoOpenFirst = false) {
  const api: { current: ToolOpenState | null } = { current: null };
  function Probe() {
    api.current = useToolOpenState(tools, autoOpenFirst);
    return null;
  }
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(h(SessionStateProvider, { sessionId: SESSION, children: h(Probe, {}) }), container);
  });
  // The provider reports ready once its load promise settles; draining the
  // microtask queue awaits that, rather than a guessed delay. `loadSession`
  // awaits the response body too, so the drain has to cover that hop.
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
  return api;
}

const SESSION = 'test-session';

describe('useToolOpenState', () => {
  test('starts everything closed except an error', async () => {
    const api = await mountHook([tool('a'), tool('b', { status: 'error' })]);
    expect(api.current?.openMap).toEqual({ a: false, b: true });
  });

  test('a skipped call never auto-opens', async () => {
    const api = await mountHook([tool('a', { status: 'skipped' })], true);
    expect(api.current?.openMap).toEqual({ a: false });
  });

  test('the first toggle flips the rendered default, not an absent key', async () => {
    const api = await mountHook([tool('a', { status: 'error' })]);
    expect(api.current?.openMap.a).toBe(true);
    await act(async () => {
      api.current?.toggle('a');
    });
    // One click closes an auto-opened error.
    expect(api.current?.openMap.a).toBe(false);
  });

  test('a stored choice is restored from the session blob', async () => {
    servedState = { [TOOL_OPEN_STATE_KEY]: { a: true } };
    const api = await mountHook([tool('a')]);
    expect(api.current?.openMap.a).toBe(true);
  });

  test('a stored choice beats the default for a skipped call too', async () => {
    servedState = { [TOOL_OPEN_STATE_KEY]: { a: true } };
    const api = await mountHook([tool('a', { status: 'skipped' })]);
    expect(api.current?.openMap.a).toBe(true);
  });

  test('a toggle is written back to the session slot', async () => {
    const api = await mountHook([tool('a')]);
    await act(async () => {
      api.current?.toggle('a');
    });
    expect(api.current?.openMap.a).toBe(true);
    // Persist is debounced; the store's cache is what a remount reads.
    setSessionKey(SESSION, TOOL_OPEN_STATE_KEY, { a: true });
    const remounted = await mountHook([tool('a')]);
    expect(remounted.current?.openMap.a).toBe(true);
  });
});

describe('useToolOpenState — a streaming eval opens itself', () => {
  /**
   * Mount a probe whose tools can be REPLACED, so a status transition is
   * observable: the reported bug is about a card that was open for the run and
   * must not snap shut when the call returns.
   */
  async function mountMutable(initial: ToolCallData[]) {
    const api: { current: ToolOpenState | null; setTools: (next: ToolCallData[]) => void } = {
      current: null,
      setTools: () => {},
    };
    function Probe() {
      const [tools, setTools] = useState(initial);
      api.setTools = setTools;
      api.current = useToolOpenState(tools, false);
      return null;
    }
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => {
      render(h(SessionStateProvider, { sessionId: SESSION, children: h(Probe, {}) }), container);
    });
    await act(async () => {
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });
    return api;
  }

  const evalTool = (partial: Partial<ToolCallData> = {}) =>
    tool('e1', { type: 'eval', name: 'eval', title: 'Counting lines', ...partial });

  test('a running eval is open, so its streamed output is visible', async () => {
    const api = await mountMutable([evalTool({ status: 'running' })]);
    expect(api.current?.openMap.e1).toBe(true);
  });

  test('it STAYS open once the call settles', async () => {
    const api = await mountMutable([evalTool({ status: 'running' })]);
    await act(async () => {
      api.setTools([evalTool({ status: 'success', output: 'line 1' })]);
    });
    // Re-deriving from `status` alone closed the card at the exact moment the
    // reader wants the result — the `wait` lesson, restated for eval.
    expect(api.current?.openMap.e1).toBe(true);
  });

  test('a settled eval from a reloaded transcript stays closed', async () => {
    // History is not a live run: opening every past eval would bury the
    // conversation under scripts nobody asked to see again.
    const api = await mountMutable([evalTool({ status: 'success', output: 'line 1' })]);
    expect(api.current?.openMap.e1).toBe(false);
  });

  test('a running bash is still folded', async () => {
    // The auto-open is for the card whose body IS the answer, not for every
    // streaming call — a bash log belongs folded.
    const api = await mountMutable([tool('b1', { status: 'running' })]);
    expect(api.current?.openMap.b1).toBe(false);
  });

  test('the reader can still close a running eval, and it stays closed', async () => {
    const api = await mountMutable([evalTool({ status: 'running' })]);
    await act(async () => {
      api.current?.toggle('e1');
    });
    expect(api.current?.openMap.e1).toBe(false);
    await act(async () => {
      api.setTools([evalTool({ status: 'success', output: 'line 1' })]);
    });
    expect(api.current?.openMap.e1).toBe(false);
  });
});
