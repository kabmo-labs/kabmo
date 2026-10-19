/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The participant hooks: `useRpc`, `useRealtime`, `useComposer`.
 *
 * Each one is a behaviour a plugin would otherwise hand-roll, and each of those
 * behaviours is a bug when it is missing:
 *
 * - `useRpc` must return a plugin's REFUSAL as a result rather than throwing.
 *   The route answers `{ ok: false, error }` at HTTP 200, because the call
 *   reached the plugin and the plugin said no — flattening that into a rejected
 *   promise turns "the plugin refused this argument" into "the network broke".
 * - `useRpc` must drop a superseded call's answer, or a slow first call repaints
 *   the panel a faster second one already moved.
 * - `useRealtime` must seed from the value on hand before subscribing: a
 *   component that mounted between two pushes would otherwise render blank.
 * - `useComposer` must WRITE through the host's state. A DOM write is reverted
 *   by the next keystroke, so the plugin's edit vanishes with no error.
 *
 * Rendered with `h()` against happy-dom, driven by the harness's own fake kit —
 * the same seam a plugin's tests use.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { configureUiKit, PluginIdProvider, useComposer, useRealtime, useRpc } from '@kabmo-labs/ui';
import { makeUiKitServices, type FakeUiKit } from '@kabmo-labs/plugin-sdk/testing';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};
let window_: Window | null = null;

function installDom(): void {
  window_ = new Window();
  const target = globalThis as unknown as Record<string, unknown>;
  const source = window_ as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = target[key];
    target[key] = source[key];
  }
}

function restoreDom(): void {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    const value = nativeGlobals[key];
    if (value === undefined) delete target[key];
    else target[key] = value;
  }
  window_ = null;
}

let host: FakeUiKit;
let container: HTMLDivElement;

beforeEach(() => {
  installDom();
  host = makeUiKitServices();
  configureUiKit(host);
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
  restoreDom();
});

/**
 * Render one hook INSIDE a plugin's scope, which is what a host surface does —
 * the id the participant hooks address comes from that context, so a test that
 * rendered outside it would only exercise the no-plugin path.
 */
function mount<T>(use: () => T, pluginId = 'demo'): { get: () => T } {
  let latest: T;
  function Probe() {
    latest = use();
    return null;
  }
  act(() => render(h(PluginIdProvider, { pluginId }, h(Probe, {})), container));
  return { get: () => latest! };
}

describe('useRpc', () => {
  test('a successful call answers the value and clears the error', async () => {
    host.rpc.stub('list', [1, 2]);
    const rpc = mount(() => useRpc<{ q: string }, number[]>('list'));

    let outcome: unknown;
    await act(async () => {
      outcome = await rpc.get().call({ q: 'today' });
    });

    expect(outcome).toEqual({ ok: true, value: [1, 2] });
    expect(rpc.get().value).toEqual([1, 2]);
    expect(rpc.get().error).toBeNull();
    expect(rpc.get().pending).toBe(false);
    expect(host.rpc.calls).toEqual([{ pluginId: 'demo', method: 'list', input: { q: 'today' } }]);
  });

  test('a plugin refusal is a RESULT, not a thrown error', async () => {
    host.rpc.stubError('save', { code: 'invalid_input', message: 'note must be a string' });
    const rpc = mount(() => useRpc('save'));

    let outcome: unknown;
    await act(async () => {
      outcome = await rpc.get().call({ note: 42 });
    });

    // The call did not throw, and the plugin's own reason survived.
    expect(outcome).toEqual({ ok: false, error: { code: 'invalid_input', message: 'note must be a string' } });
    expect(rpc.get().error).toEqual({ code: 'invalid_input', message: 'note must be a string' });
    expect(rpc.get().value).toBeNull();
  });

  test('an unstubbed method is unknown_method, exactly as the route answers', async () => {
    const rpc = mount(() => useRpc('typo'));
    let outcome: { ok: boolean } = { ok: true };
    await act(async () => {
      outcome = (await rpc.get().call(null)) as { ok: boolean };
    });
    expect(outcome.ok).toBe(false);
    expect(rpc.get().error?.code).toBe('unknown_method');
  });

  test('a superseded call does not overwrite the newer one', async () => {
    // The first call answers LATE; the second, immediately.
    let releaseFirst: (() => void) | null = null;
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let call = 0;
    configureUiKit({
      ...host,
      callRpc: async () => {
        call += 1;
        if (call === 1) {
          await first;
          return { ok: true, value: 'stale' };
        }
        return { ok: true, value: 'fresh' };
      },
    });

    const rpc = mount(() => useRpc('list'));
    await act(async () => {
      void rpc.get().call(null);
      await rpc.get().call(null);
    });
    expect(rpc.get().value).toBe('fresh');

    await act(async () => {
      releaseFirst?.();
      await first;
    });
    // The late answer for the superseded call was dropped.
    expect(rpc.get().value).toBe('fresh');
  });
});

describe('useRealtime', () => {
  test('seeds from the value on hand, then follows pushes', () => {
    host.publishTopic({ count: 1 });
    const realtime = mount(() => useRealtime<{ count: number }>());

    // Seeded without waiting for the next push.
    expect(realtime.get().value).toEqual({ count: 1 });
    expect(realtime.get().isLoading).toBe(false);

    act(() => host.publishTopic({ count: 2 }));
    expect(realtime.get().value).toEqual({ count: 2 });
  });

  test('reports stale rather than hiding it', () => {
    const realtime = mount(() => useRealtime());
    expect(realtime.get().stale).toBe(false);
  });

  test('a refresh re-announces the value on hand', () => {
    host.publishTopic('a');
    const realtime = mount(() => useRealtime<string>());
    act(() => realtime.get().refresh());
    expect(realtime.get().value).toBe('a');
  });

  test('a subscriber that arrives before any value renders loading, not blank data', () => {
    const realtime = mount(() => useRealtime());
    expect(realtime.get().value).toBeNull();
    expect(realtime.get().isLoading).toBe(true);
  });
});

describe('useComposer', () => {
  test('reads the live draft and re-renders on a change', () => {
    host.composerControl.setState({ text: 'hello', isEmpty: false });
    const composer = mount(() => useComposer());
    expect(composer.get().text).toBe('hello');
    expect(composer.get().isEmpty).toBe(false);

    act(() => host.composerControl.setState({ text: 'hello world', isEmpty: false }));
    expect(composer.get().text).toBe('hello world');
  });

  test('set writes THROUGH the host, so the draft the user sees changes', () => {
    const composer = mount(() => useComposer());
    act(() => composer.get().set('from the plugin'));
    expect(host.composerControl.sets).toEqual(['from the plugin']);
    expect(host.composerControl.state.text).toBe('from the plugin');
  });

  test('insert appends and focus is delegated', () => {
    host.composerControl.setState({ text: 'a', isEmpty: false });
    const composer = mount(() => useComposer());
    act(() => {
      composer.get().insert('b');
      composer.get().focus();
    });
    expect(host.composerControl.inserts).toEqual(['b']);
    expect(host.composerControl.state.text).toBe('ab');
    expect(host.composerControl.focusCount()).toBe(1);
  });

  test('reports the run state and the scope', () => {
    host.composerControl.setState({
      isSubmitting: true,
      scope: { kind: 'session', sessionId: 's1' },
    });
    const composer = mount(() => useComposer());
    expect(composer.get().isSubmitting).toBe(true);
    expect(composer.get().scope).toEqual({ kind: 'session', sessionId: 's1' });
  });
});
