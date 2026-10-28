/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The bundled example plugin, tested the way a plugin author's test is written.
 *
 * This is the P0 gate: it runs under `bun test` with NO Kabmo process, no
 * database and no network, using only `@kabmo-labs/kabmo-sdk/testing/app` and
 * the published kit. It exists to prove the harness can load a real bundle —
 * one that imports `@kabmo-labs/kabmo-sdk/app`, `@kabmo-labs/kabmo-ui` and
 * `@kabmo-labs/kabmo-ui/components` — and then render and drive what it registered.
 *
 * The plugin's module is imported at the TOP of this file, before any test has
 * run and therefore before any runtime exists. That ordering is the point:
 * `loadPluginApp` takes the already-imported namespace, and the runtime it
 * installs is what the module's components read when they are CALLED.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { loadPluginApp, renderSlot, type LoadedPluginApp, type RenderedSlot } from '@kabmo-labs/kabmo-sdk/testing/app';
import * as pluginModule from './app';

const PLUGIN_ID = 'session-info';

/** Let the kit's debounced write land before asserting on the store. */
function settle(ms = 500): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The DOM globals a happy-dom window provides, replaced for this suite only.
 *
 * Built here rather than imported from Kabmo's `src/test-support`: this is
 * a plugin, and a plugin's test must run from its own directory with the
 * published packages alone — the harness exists precisely so a plugin author
 * never has to reach into Kabmo's source.
 */
const DOM_GLOBALS = [
  'window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement',
  'HTMLInputElement', 'HTMLTextAreaElement', 'Event', 'MouseEvent', 'KeyboardEvent',
] as const;

type DomGlobal = (typeof DOM_GLOBALS)[number];
const pristine: Partial<Record<DomGlobal, unknown>> = {};
let captured = false;

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

function restoreDom(): void {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (key in pristine) target[key] = pristine[key];
    else delete target[key];
  }
}

let loaded: LoadedPluginApp;
let rendered: RenderedSlot | undefined;
let container: HTMLElement;

beforeEach(() => {
  installDom(new Window({ url: 'http://localhost' }));
  container = document.createElement('div');
  document.body.appendChild(container);
  loaded = loadPluginApp(pluginModule, {
    pluginId: PLUGIN_ID,
    panel: { sessionId: 'session-42', workspacePath: '/workspace/demo', theme: 'paper' },
  });
});

afterEach(() => {
  rendered?.unmount();
  rendered = undefined;
  render(null, container);
  container.remove();
  loaded.harness.dispose();
  restoreDom();
});

describe('session-info', () => {
  test('registers its three slots, with the titles and sizing it declared', () => {
    const { registrations, failures } = loaded.harness;
    expect(failures).toEqual([]);
    expect(registrations.rightPanel?.id).toBe('info');
    expect(registrations.headerPanel?.id).toBe('stats');
    expect(registrations.panel?.id).toBe('scratch');
    expect(registrations.titles).toEqual({
      rightPanel: 'Session Info',
      headerPanel: 'Session Stats',
      panel: 'Scratchpad',
    });
    expect(registrations.sizing.rightPanel).toEqual({ minWidth: 300, defaultFraction: 0.35 });
    // The header is a trigger AND a dropdown, which the registrar keeps apart.
    expect(registrations.headerDropdown).toBeFunction();
  });

  test('the right panel renders the live context', () => {
    rendered = renderSlot(loaded.harness.registrations.rightPanel!, {
      sessionId: 'session-42',
      workspacePath: '/workspace/demo',
    });
    const text = rendered.container.textContent ?? '';
    expect(text).toContain('session-42');
    expect(text).toContain('/workspace/demo');
    expect(text).toContain('paper');
  });

  test('the note field writes through the fake session store', async () => {
    rendered = renderSlot(loaded.harness.registrations.rightPanel!, {
      sessionId: 'session-42',
      workspacePath: '/workspace/demo',
    });
    const field = rendered.container.querySelector('#session-info-note') as HTMLTextAreaElement;
    expect(field).not.toBeNull();

    await act(async () => {
      field.value = 'remember this';
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // The write is debounced by the kit's hook (400ms default), so the store is
    // asserted after it lands — and only after it lands is the store the truth.
    await settle();
    expect(loaded.harness.session.read('note')).toBe('remember this');
  });

  test('the header dropdown reads the same note the panel wrote', () => {
    loaded.harness.session.write('note', 'four');
    // The dropdown is not a slot of its own: the registrar keeps it beside the
    // header registration, so a test renders it through a registration object
    // the way the host's own navbar does.
    const dropdown = loaded.harness.registrations.headerDropdown;
    expect(dropdown).toBeFunction();
    rendered = renderSlot({ id: 'stats-dropdown', component: dropdown! }, {
      sessionId: 'session-42',
      workspacePath: '/workspace/demo',
    });
    expect(rendered.container.textContent).toContain('4');
  });

  test('the panel slot persists to its own key, not the note', async () => {
    rendered = renderSlot(loaded.harness.registrations.panel!, {
      sessionId: 'session-42',
      workspacePath: '/workspace/demo',
    });
    const field = rendered.container.querySelector('#scratchpad') as HTMLTextAreaElement;
    await act(async () => {
      field.value = 'rough notes';
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await settle();
    expect(loaded.harness.session.read('scratch')).toBe('rough notes');
    expect(loaded.harness.session.read('note')).toBeNull();
  });
});
