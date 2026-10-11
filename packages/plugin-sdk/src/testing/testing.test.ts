/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The harness's own behaviour, pinned where a plugin author would feel it.
 *
 * Four properties, each of which is a bug if it regresses:
 *
 * 1. **Nothing reads the runtime global eagerly.** A plugin's `app.tsx` may be
 *    imported before any runtime exists, so the harness publishes the global and
 *    never consumes it at module scope — this file imports the harness at load
 *    time, which is the canary for that.
 * 2. **The kit is wired through `configureUiKit`** — the same function the app
 *    calls at boot — not through a mocked global, so `usePanelInfo()` and
 *    `useSessionValue()` answer a plugin component in a test.
 * 3. **`renderSlot` installs both halves itself** (see `app.test.tsx`).
 * 4. **The registrar validates what the host validates**, message for message,
 *    so a test catches what the app would refuse.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { requireServices, uiKitServices } from '@ompchamber/ui';
import { definePluginApp } from '../app';
import {
  createFakeChamberHost,
  installTestPluginRuntime,
  uninstallTestPluginRuntime,
  type FakeChamberHost,
} from './fake-host';
import { makeChamberFetchResponse, makePanelContext, makePanelHostProps, makeUiKitServices } from './fixtures';

/** A component good enough for the registrar, which only checks its type. */
function Component() {
  return null;
}

let host: FakeChamberHost | undefined;

beforeEach(() => {
  uninstallTestPluginRuntime();
});

afterEach(() => {
  host?.harness.dispose();
  host = undefined;
});

describe('createFakeChamberHost', () => {
  test('needs no runtime global, in either order', () => {
    // Property 1, positively: this file imported the harness at load time — a
    // harness that read the global eagerly would have thrown right there — and
    // building a host with NO runtime present still works, because the global is
    // only ever PUBLISHED here, never required.
    uninstallTestPluginRuntime();
    host = createFakeChamberHost({ pluginId: 'cold' });
    expect(host.harness.setup(definePluginApp((app) => app.rightPanel({ id: 'r', component: Component })))).toBe(true);
    host.harness.dispose();
    host = undefined;

    // And the other order: with a runtime already installed, the harness adopts
    // its own rather than failing on the existing one.
    installTestPluginRuntime();
    host = createFakeChamberHost({ pluginId: 'warm' });
    expect(host.harness.setup(definePluginApp((app) => app.panel({ id: 'p', component: Component })))).toBe(true);
  });

  test('installs a runtime a plugin bundle can resolve its imports from', () => {
    host = createFakeChamberHost({ pluginId: 'p' });
    const runtime = (globalThis as { __ompchamberPluginRuntime?: Record<string, unknown> }).__ompchamberPluginRuntime;
    expect(runtime).toBeDefined();
    // Every slot the build rewrites a specifier to must be present, or a plugin
    // bundle fails with "does not provide an export named …" at load.
    for (const slot of ['preact', 'hooks', 'jsxRuntime', 'jsxDevRuntime', 'compat', 'sdkApp', 'ui', 'uiComponents']) {
      expect(runtime?.[slot]).toBeDefined();
    }
  });

  test('installs the kit through configureUiKit, the seam the app itself calls', () => {
    host = createFakeChamberHost({ pluginId: 'p', panel: { sessionId: 's7' } });
    // Property 2: the SAME function `src/client/lib/plugins/kit.ts` calls at
    // boot, so the hooks a plugin uses answer in a test with no chamber.
    expect(requireServices()).toBe(host.harness.services);
    expect(requireServices().context().sessionId).toBe('s7');
  });

  test('puts the kit back on dispose, exactly as it found it', () => {
    // Not necessarily "back to null": another suite in the same run (the kit's
    // own hook tests) may have left services installed, and the harness must
    // restore whatever it found rather than clobber it.
    const before = uiKitServices();
    host = createFakeChamberHost({ pluginId: 'p' });
    expect(requireServices()).toBe(host.harness.services);

    host.harness.dispose();
    host = undefined;
    expect(uiKitServices()).toBe(before);
    // In a run where nothing had installed services, that restored state is the
    // kit's own: a component rendered outside the app gets the real error.
    if (before === null) expect(() => requireServices()).toThrow('no host services');
  });

  test('removes the runtime global on dispose', () => {
    host = createFakeChamberHost({ pluginId: 'p' });
    host.harness.dispose();
    host = undefined;
    expect((globalThis as { __ompchamberPluginRuntime?: unknown }).__ompchamberPluginRuntime).toBeUndefined();
  });
});

describe('setup validation', () => {
  test('refuses a module with no definePluginApp default export', () => {
    host = createFakeChamberHost({ pluginId: 'p' });
    expect(host.harness.setup(undefined as never)).toBe(false);
    expect(host.harness.failures).toEqual([
      { pluginId: 'p', reason: 'the bundle has no definePluginApp(...) default export' },
    ]);
  });

  test('refuses a component that is neither a function nor an object', () => {
    host = createFakeChamberHost({ pluginId: 'p' });
    const definition = definePluginApp((app) => app.rightPanel({ id: 'info', component: 'nope' as never }));
    expect(host.harness.setup(definition)).toBe(false);
    expect(host.harness.failures[0]?.reason).toBe('rightPanel "info" has no component');
  });

  test('refuses a second registration for the same slot, by name', () => {
    host = createFakeChamberHost({ pluginId: 'p' });
    const definition = definePluginApp((app) => {
      app.rightPanel({ id: 'a', component: Component });
      app.rightPanel({ id: 'b', component: Component });
    });
    expect(host.harness.setup(definition)).toBe(false);
    expect(host.harness.failures[0]?.reason).toBe('a plugin may register only one rightPanel');
  });

  test('records a throwing setup as a failure and keeps nothing it registered', () => {
    host = createFakeChamberHost({ pluginId: 'p' });
    const definition = definePluginApp((app) => {
      app.rightPanel({ id: 'a', component: Component });
      throw new Error('setup exploded');
    });
    // The host publishes a bundle's registrations only after `setup` RETURNS, so
    // a bundle that threw half way through has registered nothing.
    expect(host.harness.setup(definition)).toBe(false);
    expect(host.harness.failures).toEqual([{ pluginId: 'p', reason: 'setup exploded' }]);
    expect(host.harness.registrations.rightPanel).toBeUndefined();
  });

  test('records what a bundle registered: components, titles, sizing and the dropdown', () => {
    host = createFakeChamberHost({ pluginId: 'p' });
    const Dropdown = () => null;
    const definition = definePluginApp((app) => {
      app.rightPanel({ id: 'info', title: 'Info', component: Component, minWidth: 300, defaultFraction: 0.35 });
      app.headerPanel({ id: 'stats', title: 'Stats', component: Component, dropdown: { component: Dropdown } });
      app.settingsSection({ id: 'opts', title: 'Options', component: Component });
    });
    expect(host.harness.setup(definition)).toBe(true);

    const { registrations } = host.harness;
    expect(registrations.rightPanel?.id).toBe('info');
    expect(registrations.headerPanel?.id).toBe('stats');
    expect(registrations.settingsSection?.id).toBe('opts');
    expect(registrations.headerDropdown).toBe(Dropdown);
    expect(registrations.titles).toEqual({ rightPanel: 'Info', headerPanel: 'Stats', settingsSection: 'Options' });
    expect(registrations.sizing.rightPanel).toEqual({ minWidth: 300, defaultFraction: 0.35 });
    expect(host.harness.failures).toEqual([]);
  });

  test('accepts an object component, which the host also allows', () => {
    // The host's check is `typeof component === 'function' || 'object'`, so a
    // class-like component passes and must not be refused here either.
    host = createFakeChamberHost({ pluginId: 'p' });
    const classLike = { render: () => null };
    const definition = definePluginApp((app) => app.panel({ id: 'p', component: classLike as never }));
    expect(host.harness.setup(definition)).toBe(true);
    expect(host.harness.registrations.panel?.component).toBe(classLike as never);
  });

  test('the `host` registrar writes where the harness reads, in either order', () => {
    host = createFakeChamberHost({ pluginId: 'p' });
    // A test may call `setup(host)` directly instead of going through
    // `harness.setup`, so the registrar must keep pointing at the live state.
    definePluginApp((app) => app.panel({ id: 'direct', component: Component })).setup(host.host);
    expect(host.harness.registrations.panel?.id).toBe('direct');

    // And it must still point there after a `harness.setup` swapped the state.
    host.harness.setup(definePluginApp((app) => app.panel({ id: 'via-setup', component: Component })));
    expect(host.harness.registrations.panel?.id).toBe('via-setup');
    expect(() => host!.host.rightPanel({ id: 'late', component: Component })).not.toThrow();
    expect(host.harness.registrations.rightPanel?.id).toBe('late');
  });
});

describe('list slots', () => {
  test('records each list slot under its own key, in registration order', () => {
    host = createFakeChamberHost({ pluginId: 'p' });
    const definition = definePluginApp((app) => {
      app.messageAction({ id: 'copy', component: Component });
      app.messageAction({ id: 'quote', component: Component });
      app.composerBanner({ id: 'notice', component: Component });
    });
    expect(host.harness.setup(definition)).toBe(true);

    expect(host.harness.registrations.messageActions.map((row) => row.id)).toEqual(['copy', 'quote']);
    expect(host.harness.registrations.composerBanners.map((row) => row.id)).toEqual(['notice']);
    // Every list slot starts as an empty array, so an author's test can read
    // `.length` without a null check.
    expect(host.harness.registrations.fileOpeners).toEqual([]);
    expect(host.harness.failures).toEqual([]);
  });

  test('refuses a duplicate list-slot id, naming the slot and the id', () => {
    host = createFakeChamberHost({ pluginId: 'p' });
    const definition = definePluginApp((app) => {
      app.messageAction({ id: 'copy', component: Component });
      app.messageAction({ id: 'copy', component: Component });
    });
    expect(host.harness.setup(definition)).toBe(false);
    expect(host.harness.failures[0]?.reason).toBe('messageAction "copy" is already registered by this plugin');
    expect(host.harness.registrations.messageActions).toEqual([]);
  });

  test('keys a row per slot, so the same id in two slots is not a duplicate', () => {
    host = createFakeChamberHost({ pluginId: 'p' });
    const definition = definePluginApp((app) => {
      app.messageAction({ id: 'shared', component: Component });
      app.composerAction({ id: 'shared', component: Component });
    });
    expect(host.harness.setup(definition)).toBe(true);
    expect(host.harness.registrations.messageActions.map((row) => row.id)).toEqual(['shared']);
    expect(host.harness.registrations.composerActions.map((row) => row.id)).toEqual(['shared']);
  });

  test('a disposer removes exactly one row and leaves its neighbours', () => {
    host = createFakeChamberHost({ pluginId: 'p' });
    const dispose = host.host.messageAction({ id: 'first', component: Component });
    host.host.messageAction({ id: 'second', component: Component });
    host.host.messageAction({ id: 'third', component: Component });
    expect(host.harness.registrations.messageActions.map((row) => row.id)).toEqual(['first', 'second', 'third']);

    dispose();
    expect(host.harness.registrations.messageActions.map((row) => row.id)).toEqual(['second', 'third']);
    // A second call must not take a neighbour with it.
    dispose();
    expect(host.harness.registrations.messageActions.map((row) => row.id)).toEqual(['second', 'third']);
  });

  test('refuses a list registration with no id', () => {
    host = createFakeChamberHost({ pluginId: 'p' });
    expect(() => host!.host.fileOpener({ id: '', matches: () => true, component: Component })).toThrow(
      'fileOpener registration needs a non-empty id',
    );
  });
});

describe('harness controls', () => {
  test('session reads back what a plugin wrote, and wakes its subscribers', () => {
    host = createFakeChamberHost({ pluginId: 'p' });
    const seen: string[] = [];
    host.harness.session.subscribe('note', () => seen.push(host?.harness.session.read('note') ?? ''));

    host.harness.session.write('note', 'hello');
    expect(host.harness.session.read('note')).toBe('hello');
    expect(seen).toEqual(['hello']);
  });

  test('the JSON slot is separate from the string slot', () => {
    host = createFakeChamberHost({ pluginId: 'p' });
    host.harness.session.write('note', 'text');
    host.harness.session.writeJson('note', { open: true });
    expect(host.harness.session.read('note')).toBe('text');
    expect(host.harness.session.readJson<{ open: boolean }>('note')).toEqual({ open: true });
  });

  test('setPanelContext is readable back and notifies subscribers', () => {
    host = createFakeChamberHost({ pluginId: 'p' });
    const seen: string[] = [];
    host.harness.services.subscribe((context) => seen.push(context.theme));
    host.harness.setPanelContext({ sessionId: 's2', theme: 'night' });
    expect(host.harness.context).toEqual({ sessionId: 's2', workspacePath: '/workspace', theme: 'night' });
    expect(seen).toEqual(['night']);
  });
});

describe('fixtures', () => {
  test('makeUiKitServices answers a configured file and rejects an unknown one', async () => {
    const services = makeUiKitServices({ files: { 'notes.md': '# hi' } });
    expect(await services.readWorkspaceFile('/ws', 'notes.md')).toBe('# hi');
    await expect(services.readWorkspaceFile('/ws', 'missing.md')).rejects.toThrow('No test file is configured');
    await expect(services.readWorkspaceFile(null, 'notes.md')).rejects.toThrow('No workspace folder is active.');
  });

  test('makeUiKitServices has no markdown renderer, so the kit degrades to text', () => {
    expect(makeUiKitServices().markdown?.()).toBeNull();
  });

  test('makePanelContext and makePanelHostProps take overrides over their defaults', () => {
    expect(makePanelContext()).toEqual({ sessionId: 'session-1', workspacePath: '/workspace', theme: 'paper' });
    expect(makePanelContext({ sessionId: null }).sessionId).toBeNull();
    expect(makePanelHostProps()).toEqual({
      sessionId: 'session-1',
      rootPath: '/workspace',
      enabled: true,
      active: true,
      refreshKey: 0,
    });
    expect(makePanelHostProps({ enabled: false, refreshKey: 3 })).toMatchObject({ enabled: false, refreshKey: 3 });
  });

  test('makeChamberFetchResponse is JSON the fetch hook can parse', async () => {
    const response = makeChamberFetchResponse({ ok: true });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toEqual({ ok: true });

    const failure = makeChamberFetchResponse({ error: 'nope' }, { status: 500 });
    expect(failure.status).toBe(500);
    expect(await failure.json()).toEqual({ error: 'nope' });
  });
});
