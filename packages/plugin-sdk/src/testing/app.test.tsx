/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The app half of the harness: loading a bundle and rendering its slots.
 *
 * The property this file exists to pin is the ORDERING one. A plugin's
 * `app.tsx` is imported before any runtime exists — that is what a test file's
 * top-level `import` does — so `loadPluginApp` must take the already-imported
 * module, and `renderSlot` must install both halves (the runtime global and the
 * kit services) itself. A test that renders a component without either installed
 * must not fail with "runtime unavailable"; that failure belongs to a plugin
 * loaded outside a host, not to the harness.
 *
 * Rendered with `h()` (no JSX) against happy-dom, the repo's convention for
 * component tests.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { usePanelHost, usePanelInfo, useSessionValue, type UiKitServices } from '@kabmo-labs/ui';
import { definePluginApp, pluginRuntime } from '../app';
import { loadPluginApp, renderPanel, renderSlot, type RenderedSlot } from './app';
import { makePanelContext, makeUiKitServices } from './fixtures';

/**
 * The DOM globals a happy-dom window provides, replaced for this suite only.
 *
 * Inlined rather than imported from the chamber's `src/test-support`: this
 * package is PUBLISHED, so its tests may not reach into the chamber's source —
 * the same reason `packages/ui`'s own hook tests build their window themselves.
 */
const DOM_GLOBALS = [
  'window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement',
  'HTMLInputElement', 'HTMLTextAreaElement', 'Event', 'MouseEvent', 'KeyboardEvent',
] as const;

type DomGlobal = (typeof DOM_GLOBALS)[number];
const pristine: Partial<Record<DomGlobal, unknown>> = {};
let captured = false;

/** Install a happy-dom window, capturing the runner's own globals once. */
function installDom(win: unknown): void {
  const target = globalThis as unknown as Record<string, unknown>;
  if (!captured) {
    captured = true;
    for (const key of DOM_GLOBALS) pristine[key] = target[key];
  }
  target.window = win;
  const source = win as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (key !== 'window' && source[key] !== undefined) target[key] = source[key];
  }
}

/** Put the runner's own globals back, so the next suite starts clean. */
function restoreDom(): void {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (key in pristine) target[key] = pristine[key];
    else delete target[key];
  }
}

/**
 * A component that reads the runtime WHEN CALLED.
 *
 * This is a bundle's real shape: the build rewrites its imports to read
 * `globalThis.__ompchamberPluginRuntime` at module scope, which is why a module
 * that is imported before the harness installs one still loads — the read
 * happens at render, not at import.
 */
function RuntimeReader() {
  pluginRuntime();
  return h('span', { id: 'runtime' }, 'present');
}

function ContextReadout() {
  const info = usePanelInfo();
  return h('span', { id: 'context' }, `${info.sessionId}|${info.workspacePath}|${info.theme}`);
}

function HostReadout() {
  const host = usePanelHost();
  return h('span', { id: 'host' }, `${host.enabled}|${host.refreshKey}|${host.sessionId}`);
}

function SettingsBlock({ pluginId }: { pluginId: string }) {
  const host = usePanelHost();
  // A settings section is not inside a panel body, so the provider's fallback is
  // what it must see — an absent session, not the panel's.
  return h('span', { id: 'settings' }, `${pluginId}|${host.sessionId ?? 'none'}`);
}

function NoteField() {
  const note = useSessionValue('note', 10);
  return h('input', {
    id: 'note',
    value: note.value ?? '',
    onInput: (event: Event) => note.update((event.target as HTMLInputElement).value),
  });
}

/**
 * Built at MODULE SCOPE, before any test has run and therefore before any
 * runtime exists — the same position a plugin's own `app.tsx` is in when a test
 * file imports it.
 */
const PLUGIN_MODULE = {
  default: definePluginApp((app) => {
    app.rightPanel({ id: 'info', title: 'Info', component: ContextReadout });
    app.panel({ id: 'scratch', title: 'Scratchpad', component: NoteField });
    app.settingsSection({ id: 'opts', title: 'Options', component: SettingsBlock });
  }),
};

/** Let the kit's debounced write land before asserting on the store. */
function settle(ms = 60): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let container: HTMLElement;

beforeEach(() => {
  installDom(new Window({ url: 'http://localhost' }));
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
  restoreDom();
});

describe('loadPluginApp', () => {
  test('loads a { default } namespace and records what setup registered', () => {
    const { definition, harness } = loadPluginApp(PLUGIN_MODULE);
    expect(definition).toBe(PLUGIN_MODULE.default);
    expect(harness.registrations.rightPanel?.id).toBe('info');
    expect(harness.registrations.panel?.id).toBe('scratch');
    expect(harness.registrations.settingsSection?.id).toBe('opts');
    expect(harness.failures).toEqual([]);
    harness.dispose();
  });

  test('loads the definition itself and a thunk returning either', () => {
    const direct = loadPluginApp(PLUGIN_MODULE.default);
    expect(direct.harness.registrations.rightPanel?.id).toBe('info');
    direct.harness.dispose();

    // A thunk is how a test defers the import until after it has decided a
    // runtime should exist — the ordering case, made explicit.
    const thunked = loadPluginApp(() => PLUGIN_MODULE);
    expect(thunked.harness.registrations.rightPanel?.id).toBe('info');
    thunked.harness.dispose();
  });

  test('needs no runtime installed first, and reads the global only when called', () => {
    // Property 1, end to end: the module above was BUILT before any test ran, so
    // loading it proves nothing read the runtime at import time.
    const { harness } = loadPluginApp(PLUGIN_MODULE);
    harness.dispose();

    // And the read is genuinely deferred: with the runtime gone, CALLING it is
    // what throws — which is the failure a plugin loaded outside a host gets.
    expect(() => pluginRuntime()).toThrow('runtime is unavailable');
    expect(() => render(h(RuntimeReader, {}), container)).toThrow('runtime is unavailable');
  });

  test('throws naming the real problem when the module has no valid default export', () => {
    expect(() => loadPluginApp({ default: () => {} })).toThrow('no definePluginApp(...) default export');
    expect(() => loadPluginApp({})).toThrow('no definePluginApp(...) default export');
  });

  test('refuses a thunk that returned a Promise, rather than testing a pending one', () => {
    expect(() => loadPluginApp(async () => PLUGIN_MODULE)).toThrow('await it before calling loadPluginApp');
  });
});

describe('renderSlot', () => {
  test('installs the runtime and the kit itself, so a bare render works', () => {
    const { harness } = loadPluginApp(PLUGIN_MODULE, {
      panel: { sessionId: 's9', workspacePath: '/w9', theme: 'night' },
    });

    // No installTestPluginRuntime, no configureUiKit: `renderSlot` does both,
    // and the component proves it by reading the kit's context.
    const registration = harness.registrations.rightPanel!;
    const rendered = renderSlot(registration, { sessionId: 's9', workspacePath: '/w9' });
    expect(rendered.container.querySelector('#context')?.textContent).toBe('s9|/w9|night');
    rendered.unmount();
    harness.dispose();
  });

  test('wraps a panel in PanelHostProvider, with the props the render was given', async () => {
    const { harness } = loadPluginApp(PLUGIN_MODULE);
    const registration = { id: 'host', component: HostReadout };

    let rendered: RenderedSlot | undefined;
    await act(async () => {
      rendered = renderSlot(registration, { sessionId: 'abc', workspacePath: null, refreshKey: 7 });
    });
    expect(rendered?.container.querySelector('#host')?.textContent).toBe('true|7|abc');
    rendered?.unmount();
    harness.dispose();
  });

  test('does NOT wrap a settings section, which is not a panel body', async () => {
    const { harness } = loadPluginApp(PLUGIN_MODULE);
    const registration = harness.registrations.settingsSection!;

    let rendered: RenderedSlot | undefined;
    await act(async () => {
      rendered = renderSlot(registration, { pluginId: 'p' });
    });
    expect(rendered?.container.querySelector('#settings')?.textContent).toBe('p|none');
    rendered?.unmount();
    harness.dispose();
  });

  test('honours an override of the services and of the context', async () => {
    const { harness } = loadPluginApp(PLUGIN_MODULE);
    const services = makeUiKitServices({ context: { sessionId: 'custom', workspacePath: '/c', theme: 'ink' } });
    const registration = harness.registrations.rightPanel!;

    let rendered: RenderedSlot | undefined;
    await act(async () => {
      rendered = renderSlot(
        registration,
        { sessionId: 'custom', workspacePath: '/c' },
        { services, context: { theme: 'paper' } },
      );
    });
    expect(rendered?.container.querySelector('#context')?.textContent).toBe('custom|/c|paper');
    rendered?.unmount();
    harness.dispose();
  });

  test('refuses a `context` override it cannot apply, rather than ignoring it', () => {
    const { harness } = loadPluginApp(PLUGIN_MODULE);
    // A host services object the harness cannot move — the shape a test gets if
    // it passes its own. The override has nothing to act on, so it is refused
    // rather than silently not happening.
    const bare: UiKitServices = {
      context: () => makePanelContext(),
      subscribe: () => () => {},
      getSessionValue: () => null,
      setSessionValue: () => {},
      readWorkspaceFile: async () => '',
    };
    expect(() =>
      renderSlot(
        harness.registrations.rightPanel!,
        { sessionId: null, workspacePath: null },
        { services: bare, context: { theme: 'night' } },
      ),
    ).toThrow('`context` needs the harness');
    harness.dispose();
  });

  test('unmount removes the container it created', async () => {
    const { harness } = loadPluginApp(PLUGIN_MODULE);
    const rendered = renderSlot(harness.registrations.rightPanel!, { sessionId: null, workspacePath: null });
    expect(document.body.contains(rendered.container)).toBe(true);
    rendered.unmount();
    expect(document.body.contains(rendered.container)).toBe(false);
    harness.dispose();
  });

  test('a component writing through the kit lands in the harness session store', async () => {
    const { harness } = loadPluginApp(PLUGIN_MODULE);
    const registration = harness.registrations.panel!;

    let rendered: RenderedSlot | undefined;
    await act(async () => {
      rendered = renderSlot(registration, { sessionId: 'session-1', workspacePath: '/workspace' });
    });
    const field = rendered?.container.querySelector('#note') as HTMLInputElement;
    await act(async () => {
      field.value = 'hello';
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    // The debounce is the hook's, so the store is only asserted after it lands.
    await settle();
    expect(harness.session.read('note')).toBe('hello');
    rendered?.unmount();
    harness.dispose();
  });
});

describe('renderPanel', () => {
  test('renders the right panel with the harness context a host would pass', async () => {
    const { harness } = loadPluginApp(PLUGIN_MODULE, { panel: { sessionId: 's3', workspacePath: '/w3' } });
    let rendered: RenderedSlot | undefined;
    await act(async () => {
      rendered = renderPanel('plugin-under-test');
    });
    expect(rendered?.container.querySelector('#context')?.textContent).toBe('s3|/w3|paper');
    rendered?.unmount();
    harness.dispose();
  });

  test('throws when nothing was loaded, or the plugin has no right panel', () => {
    expect(() => renderPanel('never-loaded')).toThrow('no plugin "never-loaded" has been loaded');

    const { harness } = loadPluginApp(
      { default: definePluginApp((app) => app.panel({ id: 'only', component: NoteField })) },
      { pluginId: 'no-right-panel' },
    );
    expect(() => renderPanel('no-right-panel')).toThrow('registered no right panel');
    harness.dispose();
  });
});
