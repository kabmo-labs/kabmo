/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The app-side harness: load a plugin's bundle and render what it registered.
 *
 * This is the half that needs a DOM, which is why it is a separate subpath
 * (`@kabmo-labs/plugin-sdk/testing/app`) from the backend half: a test of a
 * plugin's `setup` alone must not have to install happy-dom.
 *
 * Two properties it exists to hold:
 *
 * - **`loadPluginApp` takes a module, not a runtime.** A plugin's `app.tsx` is
 *   imported BEFORE any runtime exists — that is the normal order in a test file
 *   whose top-level `import` runs first — so nothing here reads
 *   `globalThis.__ompchamberPluginRuntime` at module scope. The runtime is
 *   installed when the harness runs, and `pluginRuntime()` throws only when a
 *   component is CALLED without one.
 * - **`renderSlot` installs both halves itself.** Rendering a registered
 *   component is the whole test; requiring the caller to remember a runtime
 *   install and a kit install first would turn the assertion into a confusing
 *   "runtime unavailable" instead.
 */

import type { ComponentType } from 'preact';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import {
  PanelHostProvider,
  configureUiKit,
  uiKitServices,
  type PanelContext,
  type UiKitServices,
} from '@kabmo-labs/ui';
import { isPluginAppDefinition, type PluginAppDefinition, type RightPanelProps } from '../app';
import {
  NO_DEFAULT_EXPORT,
  createFakeChamberHost,
  installTestPluginRuntime,
  uninstallTestPluginRuntime,
  type FakeChamberHarness,
} from './fake-host';
import { makePanelHostProps, makeUiKitServices, type FakeUiKit } from './fixtures';

export { installTestPluginRuntime, uninstallTestPluginRuntime };

export interface LoadedPluginApp {
  definition: PluginAppDefinition;
  harness: FakeChamberHarness;
}

/**
 * Whether these props belong to a `settingsSection`.
 *
 * A settings section is the one slot that is NOT rendered inside a panel body —
 * it is a block in the settings pane with its own props type — so it is the one
 * slot that must not be wrapped in a panel host.
 */
function isSettingsSectionProps(props: object): boolean {
  return 'pluginId' in props;
}

function isFakeUiKit(services: UiKitServices): services is FakeUiKit {
  return 'setContext' in services && typeof services.setContext === 'function';
}

/** The module's default export, or the module itself when it has none. */
function defaultExportOf(module: unknown): unknown {
  if (typeof module === 'object' && module !== null && 'default' in module) return module.default;
  return module;
}

export interface RenderSlotOverrides {
  /** The kit services to render with. Defaults to the installed ones, else a fake. */
  services?: UiKitServices;
  /** The panel context to render with. Needs the harness's own services. */
  context?: Partial<PanelContext>;
}

/**
 * Point the kit at the services this render should use.
 *
 * Reusing the INSTALLED services rather than always installing a fresh fake is
 * what keeps a test's `harness.session` handle reading the same store the
 * component writes to; installing a new one per render would silently split
 * them, and the assertion would fail for a reason the test never implied.
 */
function resolveServices(overrides: RenderSlotOverrides): UiKitServices {
  const services = overrides.services ?? uiKitServices() ?? makeUiKitServices();
  const { context } = overrides;
  if (context) {
    // Only the harness's own fake can be moved: a caller that passed a bare
    // `UiKitServices` has no way to change its context, and silently ignoring
    // the override would make the render answer a context the test did not ask
    // for.
    if (!isFakeUiKit(services)) {
      throw new Error(
        "renderSlot: `context` needs the harness's own services — omit `services`, or pass what makeUiKitServices() returns.",
      );
    }
    services.setContext(context);
  }
  configureUiKit(services);
  return services;
}

export interface RenderedSlot {
  /** The detached element the component was rendered into. */
  container: HTMLElement;
  /** Unmount and drop the container. */
  unmount(): void;
}

/**
 * Render one registration's component with the given props.
 *
 * The component is rendered through the HOST's own Preact. A panel — the right
 * panel, the editor column, a header trigger or dropdown — is wrapped in the
 * host's `PanelHostProvider`, so a plugin that reads `usePanelHost()` sees what
 * a panel body sees rather than the permissive fallback that exists for a
 * component rendered outside the app. A `settingsSection` is the one slot that
 * is NOT a panel body (its props are the section's own), so it is rendered
 * without the provider.
 */
export function renderSlot<Props extends object>(
  registration: { id: string; title?: string; component: ComponentType<Props> },
  props: Props,
  overrides: RenderSlotOverrides = {},
): RenderedSlot {
  if (typeof document === 'undefined') {
    throw new Error(
      'renderSlot needs a DOM — install happy-dom globals in the test before rendering a plugin component.',
    );
  }
  installTestPluginRuntime();
  resolveServices(overrides);

  const container = document.createElement('div');
  document.body.appendChild(container);

  const Component = registration.component;
  // Through `act`, so the mount effects flush before this returns. A plugin's
  // hooks read the store and subscribe in an effect, and a test that interacted
  // with the DOM before that ran would be driving a component that had not
  // finished mounting — the value it typed would be clobbered by the first read.
  act(() => {
    if (isSettingsSectionProps(props)) {
      render(h(Component, props), container);
    } else {
      const body = { ...makePanelHostProps(), ...props };
      render(h(PanelHostProvider, { value: body, children: h(Component, props) }), container);
    }
  });

  return {
    container,
    unmount() {
      act(() => {
        render(null, container);
      });
      container.remove();
    },
  };
}

/** Every plugin `loadPluginApp` has loaded, by id, for `renderPanel`. */
const loadedPlugins = new Map<string, FakeChamberHarness>();

export interface LoadPluginAppOptions {
  /** The id the harness records against, and `renderPanel` looks up. */
  pluginId?: string;
  /** The context the fake kit answers with. */
  panel?: Partial<PanelContext>;
  /** Files the fake `readWorkspaceFile` answers, by workspace-relative path. */
  files?: Record<string, string>;
}

/**
 * Load a plugin's default export and run its `setup` against a fake host.
 *
 * The input may be the imported namespace (`{ default }`), the definition
 * itself, or a thunk returning either — a thunk is how a test defers a heavy
 * import until after it has decided the runtime should exist, and it is the one
 * case that makes the install-before-import ordering visible.
 *
 * A `setup` that THROWS is not re-thrown: the harness records it the way the
 * host does (`harness.failures`), because "the bundle was refused, with this
 * reason" is itself a thing a test asserts.
 */
export function loadPluginApp(moduleOrThunk: unknown, options: LoadPluginAppOptions = {}): LoadedPluginApp {
  const { pluginId = 'plugin-under-test', panel, files } = options;
  const module = typeof moduleOrThunk === 'function' ? (moduleOrThunk as () => unknown)() : moduleOrThunk;
  if (typeof module === 'object' && module !== null && 'then' in module) {
    throw new Error('loadPluginApp: the thunk returned a Promise — await it before calling loadPluginApp.');
  }

  const definition = defaultExportOf(module);
  if (!isPluginAppDefinition(definition)) throw new Error(`loadPluginApp: ${NO_DEFAULT_EXPORT}`);

  const { harness } = createFakeChamberHost({ pluginId, ...(panel ? { panel } : {}), ...(files ? { files } : {}) });
  harness.setup(definition);
  loadedPlugins.set(pluginId, harness);
  return { definition, harness };
}

/**
 * Render the RIGHT PANEL a plugin loaded through `loadPluginApp` registered.
 *
 * The right panel is the position the activity bar shows, so it is the one a
 * test most often wants; every other slot is reachable through `renderSlot`
 * with the registration the harness recorded. Props default to the harness's own
 * context, which is the session and workspace a real host would pass.
 */
export function renderPanel(
  pluginId: string,
  props: Partial<RightPanelProps> = {},
  overrides: RenderSlotOverrides = {},
): RenderedSlot {
  const harness = loadedPlugins.get(pluginId);
  if (!harness) {
    throw new Error(`renderPanel: no plugin "${pluginId}" has been loaded — call loadPluginApp() first.`);
  }
  const registration = harness.registrations.rightPanel;
  if (!registration) {
    throw new Error(
      `renderPanel: plugin "${pluginId}" registered no right panel — render its other slots with renderSlot().`,
    );
  }
  const { sessionId, workspacePath } = harness.context;
  return renderSlot(registration, { sessionId, workspacePath, ...props }, overrides);
}
