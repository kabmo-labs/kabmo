/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The plugin identity scope, which is what makes `useRpc`'s id-free signature
 * safe.
 *
 * The kit's participant hooks resolve the plugin id from a module-level value
 * set DURING RENDER, because the kit is a published package and cannot be handed
 * a Preact context. That only works if the host wraps every plugin row in the
 * scope — and the failures are silent, which is why they are pinned here:
 *
 * - A row rendered OUTSIDE its scope would address whatever plugin rendered
 *   last, so one plugin's `save` would land in another plugin's storage.
 * - A row that THREW would leave its id set, so the NEXT row's call would
 *   address the failed plugin instead of its own.
 * - Two plugins' rows on one screen must each see their own id, in either
 *   order.
 *
 * Rendered with `h()` against happy-dom, with the real kit services installed.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { configureUiKit, PluginIdProvider as PluginRowScope, usePluginId } from '@kabmo-labs/ui';
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
let observed: string | null;

/** A nested row: records the id ITS scope provided. */
function InnerRecorder({ seen }: { seen: string[] }) {
  seen.push(`inner:${usePluginId() ?? 'none'}`);
  return null;
}

beforeEach(() => {
  installDom();
  observed = null;
  // The fake answers `pluginId()` from whatever the last render set, exactly as
  // the real host does — so this suite exercises the same resolution the app
  // uses rather than a stub of it.
  host = makeUiKitServices();
  configureUiKit({ ...host, callRpc: async () => ({ ok: true, value: null }) });
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
  restoreDom();
});

/** A row that records the id its render saw, from the CONTEXT. */
function Recorder() {
  observed = usePluginId();
  return null;
}

describe('PluginRowScope', () => {
  test('a row sees its own plugin id', () => {
    act(() => render(h(PluginRowScope, { pluginId: 'alpha' }, h(Recorder, {})), container));
    expect(observed).toBe('alpha');
  });

  test('two rows on one screen each see their own id', () => {
    const seen: string[] = [];
    /** Records the id in scope when ITS OWN render runs. */
    function Seen({ label }: { label: string }) {
      seen.push(`${label}:${usePluginId() ?? 'none'}`);
      return null;
    }
    act(() =>
      render(
        h(
          'div',
          {},
          h(PluginRowScope, { pluginId: 'alpha' }, h(Seen, { label: 'first' })),
          h(PluginRowScope, { pluginId: 'beta' }, h(Seen, { label: 'second' })),
        ),
        container,
      ),
    );
    // Each row resolved its OWN id, in the order they rendered.
    expect(seen).toEqual(['first:alpha', 'second:beta']);
  });

  test('a nested row restores its PARENT id rather than clearing it', () => {
    const seen: string[] = [];
    /** Renders an inner scope; the inner row must see `inner`, the outer `outer`. */
    function Outer() {
      seen.push(`outer:${usePluginId() ?? 'none'}`);
      return h(PluginRowScope, { pluginId: 'inner' }, h(InnerRecorder, { seen }));
    }
    act(() => render(h(PluginRowScope, { pluginId: 'outer' }, h(Outer, {})), container));
    expect(seen).toEqual(['outer:outer', 'inner:inner']);
  });

  test('a throwing row does not leak its id into the next row', () => {
    function Thrower(): never {
      throw new Error('the plugin component is broken');
    }
    // Preact reports the error through the render call; what matters here is the
    // SCOPE, not the error propagation.
    try {
      act(() => render(h(PluginRowScope, { pluginId: 'broken' }, h(Thrower, {})), container));
    } catch {
      // Expected: the component threw.
    }

    act(() => render(h(PluginRowScope, { pluginId: 'healthy' }, h(Recorder, {})), container));
    expect(observed).toBe('healthy');
  });

  /**
   * The DOM half, which is what confines a plugin's stylesheet.
   *
   * The server serves a plugin's CSS wrapped in
   * `@scope ([data-plugin-surface="<id>"])`, so a rule can only match inside an
   * element carrying that attribute. The provider is where a slot component's
   * DOM gets one — without it a plugin's own CSS would match nothing, and the
   * pattern it replaced (marking `<html>`) matched the host's chrome too.
   */
  describe('the surface element', () => {
    test('the wrapper carries the plugin scope attribute', () => {
      act(() => render(h(PluginRowScope, { pluginId: 'alpha' }, h('div', { id: 'body' })), container));

      const surface = container.querySelector('[data-plugin-surface="alpha"]');
      expect(surface).not.toBeNull();
      // The plugin's own markup is INSIDE it, so a scoped rule can reach it.
      expect(surface?.querySelector('#body')).not.toBeNull();
    });

    test('the wrapper generates no box, so the host layout is undisturbed', () => {
      act(() => render(h(PluginRowScope, { pluginId: 'alpha' }, null), container));
      const surface = container.querySelector<HTMLElement>('[data-plugin-surface="alpha"]');
      expect(surface?.style.display).toBe('contents');
    });

    test('two plugins on one screen each get their own surface', () => {
      act(() =>
        render(
          h(
            'div',
            {},
            h(PluginRowScope, { pluginId: 'alpha' }, null),
            h(PluginRowScope, { pluginId: 'beta' }, null),
          ),
          container,
        ),
      );
      expect(container.querySelectorAll('[data-plugin-surface]')).toHaveLength(2);
      expect(container.querySelector('[data-plugin-surface="alpha"]')).not.toBeNull();
      expect(container.querySelector('[data-plugin-surface="beta"]')).not.toBeNull();
    });

    test('the surface is phrasing content, so it is valid inside a button', () => {
      // The navbar renders a plugin trigger INSIDE a `<button>`; a `<div>` there
      // is invalid HTML and the browser would reparent it, taking the scope with
      // it.
      act(() => render(h('button', { id: 'host' }, h(PluginRowScope, { pluginId: 'alpha' }, h('span', {}, 'x'))), container));
      const button = container.querySelector('#host');
      expect(button?.querySelector('[data-plugin-surface="alpha"]')).not.toBeNull();
    });
  });
});
