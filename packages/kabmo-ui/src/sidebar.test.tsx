/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The sidebar hooks, driven through the harness fakes.
 *
 * Two properties are what a plugin depends on:
 *
 * - **The read is reactive.** A push from the host reaches a mounted component,
 *   so a list does not freeze at what it read at mount.
 * - **A refusal is a VALUE, not a throw.** The host answers `false`; the hook
 *   surfaces the reason on `error` and keeps the promise resolvable, because a
 *   plugin that had to catch would lose the host's own wording.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { configureUiKit, PluginIdProvider, experimental_useSidebarThreads, experimental_useSidebarThreadActions } from '@kabmo-labs/kabmo-ui';
import { makeUiKitServices, type FakeUiKit } from '@kabmo-labs/kabmo-sdk/testing';
import type { SidebarThread } from '@kabmo-labs/kabmo-sdk';

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

function thread(id: string, title: string): SidebarThread {
  return { id, folderId: '1', title };
}

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

/** Render one hook inside a plugin's scope, as a host surface does. */
function mount<T>(use: () => T, pluginId = 'demo'): { get: () => T } {
  let latest: T;
  function Probe() {
    latest = use();
    return null;
  }
  act(() => render(h(PluginIdProvider, { pluginId }, h(Probe, {})), container));
  return { get: () => latest! };
}

describe('experimental_useSidebarThreads', () => {
  test('reads the host’s current list on mount', () => {
    host.sidebarControl.setThreads([thread('s1', 'First'), thread('s2', 'Second')]);
    const sidebar = mount(() => experimental_useSidebarThreads());

    expect(sidebar.get().threads.map((t) => t.id)).toEqual(['s1', 's2']);
    expect(sidebar.get().isLoading).toBe(false);
  });

  test('a host push reaches the mounted component', () => {
    host.sidebarControl.setThreads([thread('s1', 'First')]);
    const sidebar = mount(() => experimental_useSidebarThreads());
    expect(sidebar.get().threads).toHaveLength(1);

    act(() => {
      host.sidebarControl.setThreads([thread('s1', 'First'), thread('s2', 'Added later')]);
    });

    expect(sidebar.get().threads).toHaveLength(2);
    expect(sidebar.get().threads[1]?.title).toBe('Added later');
  });

  test('stale is surfaced rather than hidden', () => {
    // A list shown as current when the socket is down is worse than one that
    // says so, so the flag travels with the value.
    const staleHost = makeUiKitServices({ sidebarStale: true, threads: [thread('s1', 'x')] });
    configureUiKit(staleHost);
    const sidebar = mount(() => experimental_useSidebarThreads());
    expect(sidebar.get().stale).toBe(true);
  });

  test('an older host without the service answers loaded-and-empty', () => {
    // Honest rather than broken: there is nothing to wait for.
    const bare = makeUiKitServices();
    delete (bare as { subscribeSidebarThreads?: unknown }).subscribeSidebarThreads;
    delete (bare as { sidebarThreads?: unknown }).sidebarThreads;
    configureUiKit(bare);

    const sidebar = mount(() => experimental_useSidebarThreads());
    expect(sidebar.get().threads).toEqual([]);
    expect(sidebar.get().isLoading).toBe(false);
  });
});

describe('experimental_useSidebarThreadActions', () => {
  test('rename reaches the host and answers true', async () => {
    const actions = mount(() => experimental_useSidebarThreadActions());
    let ok = false;
    await act(async () => {
      ok = await actions.get().rename('s1', 'A new name');
    });

    expect(ok).toBe(true);
    expect(host.sidebarControl.calls).toEqual([{ action: 'rename', args: ['s1', 'A new name'] }]);
    expect(actions.get().error).toBeNull();
  });

  test('a refusal answers false and surfaces the host’s reason', async () => {
    // The host answers the refusal as a value; a plugin must not have to catch.
    host.sidebarControl.failNext('the name is empty');
    const actions = mount(() => experimental_useSidebarThreadActions());

    let ok = true;
    await act(async () => {
      ok = await actions.get().rename('s1', '');
    });

    expect(ok).toBe(false);
    expect(actions.get().error).toBe('the name is empty');
  });

  test('the reason clears on the next attempt', async () => {
    host.sidebarControl.failNext('nope');
    const actions = mount(() => experimental_useSidebarThreadActions());
    await act(async () => {
      await actions.get().rename('s1', 'x');
    });
    expect(actions.get().error).toBe('nope');

    await act(async () => {
      await actions.get().rename('s1', 'y');
    });
    expect(actions.get().error).toBeNull();
  });

  test('archive, markSeen and remove each reach the host', async () => {
    const actions = mount(() => experimental_useSidebarThreadActions());
    await act(async () => {
      await actions.get().setArchived('s1', true);
      await actions.get().markSeen('s1');
      await actions.get().remove('s1');
    });

    expect(host.sidebarControl.calls.map((c) => c.action)).toEqual(['setArchived', 'markSeen', 'remove']);
  });

  test('open and openNew reach the host', () => {
    const actions = mount(() => experimental_useSidebarThreadActions());
    act(() => {
      actions.get().open('s9');
      actions.get().openNew({ folderId: '3' });
    });

    expect(host.sidebarControl.calls).toEqual([
      { action: 'open', args: ['s9'] },
      { action: 'openNew', args: [{ folderId: '3' }] },
    ]);
  });
});
