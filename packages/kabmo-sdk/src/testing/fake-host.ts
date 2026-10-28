/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The fake host: the registrar a plugin's `setup` is called with, the runtime
 * global its bundle reads, and the kit services its components use.
 *
 * It is a SECOND implementation of the host's contract, not a wrapper over the
 * host's source: this package is published, so it cannot import
 * `src/client/lib/plugins/*`, and a harness that did would only ever prove the
 * host agrees with itself. The validation below is therefore written from the
 * same rules as `src/client/lib/plugins/slots.ts` — message for message — and
 * this package's tests pin it.
 *
 * The runtime global is PUBLISHED here, never READ at module scope: a plugin's
 * `app.tsx` may be imported before any runtime exists, and `pluginRuntime()`
 * throws only when it is called. An eager read would break that ordering, which
 * is the one property that lets `loadPluginApp` take an already-imported module.
 */

import type { ComponentType } from 'preact';
import * as preact from 'preact';
import * as hooks from 'preact/hooks';
import * as jsxRuntime from 'preact/jsx-runtime';
import * as jsxDevRuntime from 'preact/jsx-dev-runtime';
import * as compat from 'preact/compat';
import * as ui from '@kabmo-labs/kabmo-ui';
import * as uiComponents from '@kabmo-labs/kabmo-ui/components';
import { configureUiKit, uiKitServices, type PanelContext, type UiKitServices } from '@kabmo-labs/kabmo-ui';
import * as sdkApp from '../app';
import {
  isPluginAppDefinition,
  type HeaderDropdownProps,
  type HeaderPanelRegistration,
  type PanelRegistration,
  type PluginApp,
  type PluginAppDefinition,
  type RightPanelRegistration,
  type SettingsSectionRegistration,
} from '../app';
import { makeUiKitServices, type FakeSessionHandle, type FakeUiKit } from './fixtures';
import { createListRegistrar, emptyListRegistrations, type FakeListRegistrations } from './list-slots';

/** The four slots a plugin may fill, one component each. */
export type SlotName = 'rightPanel' | 'panel' | 'headerPanel' | 'settingsSection';

/** The modules a plugin bundle borrows from the host — one instance of each. */
const RUNTIME_SLOTS = {
  preact,
  hooks,
  jsxRuntime,
  jsxDevRuntime,
  compat,
  sdkApp,
  ui,
  uiComponents,
} as const;

/** What the host says when a bundle's default export is not a definition. */
export const NO_DEFAULT_EXPORT = 'the bundle has no definePluginApp(...) default export';

/**
 * Publish the runtime a plugin bundle reads.
 *
 * Assigns rather than the host's `??=`: a test asserts on the runtime THIS call
 * installed, so a value left behind by another file — or by a real host — must
 * not survive into it. The host's idempotence exists for `bun --hot`, which a
 * test has none of.
 */
export function installTestPluginRuntime(): void {
  (globalThis as { __kabmoPluginRuntime?: unknown }).__kabmoPluginRuntime = RUNTIME_SLOTS;
}

/** Remove the runtime, so a test can prove a component fails without a host. */
export function uninstallTestPluginRuntime(): void {
  delete (globalThis as { __kabmoPluginRuntime?: unknown }).__kabmoPluginRuntime;
}

/**
 * Install kit services, remembering what was there so `dispose` can put it back.
 *
 * The kit's seam has no "unset" — `configureUiKit` only ever assigns — so the
 * previous value is kept here. Without that restore, one file's fake answers
 * `requireServices()` in the next, and a suite that meant to test the
 * "no host services" path passes for the wrong reason.
 */
let previousServices: UiKitServices | null = null;
let kitInstalled = false;

function installKitServices(services: FakeUiKit): void {
  if (!kitInstalled) {
    previousServices = uiKitServices();
    kitInstalled = true;
  }
  configureUiKit(services);
}

function restoreKitServices(): void {
  if (!kitInstalled) return;
  kitInstalled = false;
  // `configureUiKit` has no unset, and `null` is the module's own "no services"
  // state — what `uiKitServices()` returns outside the app — so putting it back
  // is what makes `requireServices()` throw again after a dispose.
  configureUiKit(previousServices as UiKitServices);
  previousServices = null;
}

/** What a successful `setup` registered, plus what the bundle declared. */
export interface FakeRegistrations extends FakeListRegistrations {
  rightPanel?: RightPanelRegistration;
  panel?: PanelRegistration;
  headerPanel?: HeaderPanelRegistration;
  settingsSection?: SettingsSectionRegistration;
  /** The header's dropdown component, when the registration declared one. */
  headerDropdown?: ComponentType<HeaderDropdownProps>;
  /** The panel a header trigger opens, when the registration declared one. */
  headerOpensPanel?: 'rightPanel' | 'panel';
  /** Titles the bundle declared, for a tooltip or a tab label. */
  titles: Partial<Record<SlotName, string>>;
  /** Sizing the bundle declared for its panels, where it declared any. */
  sizing: Partial<Record<'rightPanel' | 'panel', { minWidth?: number; defaultFraction?: number }>>;
}

/** One bundle could not load, or threw before it finished registering. */
export interface FakeKabmoFailure {
  pluginId: string;
  reason: string;
}

export interface FakeKabmoHostOptions {
  pluginId: string;
  /** The context the fake kit answers with before a test moves it. */
  panel?: Partial<PanelContext>;
  /** Files the fake `readWorkspaceFile` answers, by workspace-relative path. */
  files?: Record<string, string>;
}

/** The controls a test drives the fake host with. */
export interface FakeKabmoHarness {
  readonly pluginId: string;
  /** What `setup` registered. Empty until a setup call succeeds. */
  readonly registrations: FakeRegistrations;
  /** Every bundle that could not load or threw, in order. */
  readonly failures: FakeKabmoFailure[];
  /**
   * Run a definition against the registrar, exactly as the host does: validate,
   * call `setup`, and on a throw record the failure and keep NOTHING.
   */
  setup(definition: PluginAppDefinition): boolean;
  /** The context as it stands. Move it through `setPanelContext`. */
  readonly context: PanelContext;
  /** Move the context and wake every `usePanelInfo` reader. */
  setPanelContext(next: Partial<PanelContext>): void;
  /** The fake kit's services, for seeding files or reading the context. */
  readonly services: FakeUiKit;
  /** The per-session slots, for asserting what a plugin persisted. */
  readonly session: FakeSessionHandle;
  /** Remove the runtime global and put the kit's services back. */
  dispose(): void;
}

export interface FakeKabmoHost {
  host: PluginApp;
  harness: FakeKabmoHarness;
}

function emptyRegistrations(): FakeRegistrations {
  return { ...emptyListRegistrations(), titles: {}, sizing: {} };
}

/**
 * Build a registrar that validates what the host validates.
 *
 * `registrations` is read through a function rather than handed in as an object
 * so that the registrar always writes into the state the harness CURRENTLY
 * holds: `harness.setup` swaps in a fresh object per attempt (the host publishes
 * a bundle's registrations only after `setup` returns), and the `host` a caller
 * passes to `setup` directly must keep writing where the harness reads.
 */
function createRegistrar(pluginId: string, registrations: () => FakeRegistrations): PluginApp {
  /** The host's two refusals, in its order: no component, then a duplicate. */
  const validate = (slot: SlotName, registration: { id: string; title?: string; component: unknown }): void => {
    const { id, title, component } = registration;
    if (typeof component !== 'function' && typeof component !== 'object') {
      throw new Error(`${slot} "${id}" has no component`);
    }
    if (registrations()[slot]) throw new Error(`a plugin may register only one ${slot}`);
    if (title) registrations().titles[slot] = title;
  };

  return {
    pluginId,
    rightPanel: (registration) => {
      validate('rightPanel', registration);
      const state = registrations();
      state.sizing.rightPanel = { minWidth: registration.minWidth, defaultFraction: registration.defaultFraction };
      state.rightPanel = registration;
    },
    panel: (registration) => {
      validate('panel', registration);
      const state = registrations();
      state.sizing.panel = { minWidth: registration.minWidth, defaultFraction: registration.defaultFraction };
      state.panel = registration;
    },
    // The dropdown is part of the header registration but not a slot of its
    // own, exactly as the host holds it: a header without one is a static
    // readout rather than a button that opens nothing.
    headerPanel: ({ dropdown, opensPanel, ...registration }) => {
      validate('headerPanel', registration);
      if (dropdown && opensPanel) {
        throw new Error(
          `headerPanel "${registration.id}" declares both a dropdown and opensPanel — a trigger has one click, so it can open one of them`,
        );
      }
      const state = registrations();
      state.headerPanel = registration;
      if (dropdown) state.headerDropdown = dropdown.component;
      if (opensPanel) state.headerOpensPanel = opensPanel;
    },
    settingsSection: (registration) => {
      validate('settingsSection', registration);
      registrations().settingsSection = registration;
    },
    // The list slots come from their own module: keyed, multi, each returning
    // the disposer for exactly its own row.
    ...createListRegistrar(registrations),
  };
}

/**
 * Create a fake host and harness, with the runtime global and the kit installed.
 *
 * Both halves are installed here rather than by the caller because a plugin test
 * is about the plugin: a harness that demanded two setup calls would be two
 * places to forget, and the failure mode is an unhelpful "runtime unavailable".
 */
export function createFakeKabmoHost(options: FakeKabmoHostOptions): FakeKabmoHost {
  const { pluginId } = options;
  const services = makeUiKitServices({ context: options.panel, files: options.files });

  installTestPluginRuntime();
  installKitServices(services);

  const failures: FakeKabmoFailure[] = [];
  let registrations = emptyRegistrations();
  const record = (reason: string) => {
    failures.push({ pluginId, reason });
  };

  const harness: FakeKabmoHarness = {
    pluginId,
    get registrations() {
      return registrations;
    },
    failures,
    setup(definition) {
      if (!isPluginAppDefinition(definition)) {
        record(NO_DEFAULT_EXPORT);
        return false;
      }
      const next = emptyRegistrations();
      try {
        definition.setup(createRegistrar(pluginId, () => next));
      } catch (error) {
        record(error instanceof Error ? error.message : String(error));
        return false;
      }
      // After `setup`, because a plugin may register its header before the
      // panel it names. A button opening a panel this bundle never contributed
      // is a click with nothing behind it.
      const opens = next.headerOpensPanel;
      if (opens && !next[opens]) {
        record(`headerPanel opensPanel "${opens}" names a panel this plugin did not register`);
        return false;
      }
      registrations = next;
      return true;
    },
    get context() {
      return services.currentContext;
    },
    setPanelContext: (next) => services.setContext(next),
    services,
    session: services.session,
    dispose: () => {
      uninstallTestPluginRuntime();
      restoreKitServices();
    },
  };

  return { host: createRegistrar(pluginId, () => registrations), harness };
}

/** @deprecated Use `FakeKabmoHostOptions`. */
export type FakeChamberHostOptions = FakeKabmoHostOptions;

/** @deprecated Use `FakeKabmoHost`. */
export type FakeChamberHost = FakeKabmoHost;

/** @deprecated Use `FakeKabmoHarness`. */
export type FakeChamberHarness = FakeKabmoHarness;

/** @deprecated Use `FakeKabmoFailure`. */
export type FakeChamberFailure = FakeKabmoFailure;

/** @deprecated Use `createFakeKabmoHost`. */
export const createFakeChamberHost = createFakeKabmoHost;
