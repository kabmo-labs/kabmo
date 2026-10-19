/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `@kabmo-labs/kabmo-sdk/testing` — the backend half of the harness.
 *
 * A plugin author's test imports this, not Kabmo's source: the harness is
 * a SECOND implementation of the runtime contract, so it is published alongside
 * the contract it implements and a test can run with no Kabmo process, no
 * database and no network.
 *
 * The split from `@kabmo-labs/kabmo-sdk/testing/app` is deliberate: this half
 * touches no DOM and installs no components, so a test of a bundle's `setup`
 * alone can assert what it registered without installing happy-dom.
 *
 * The one thing this half does NOT do is read the runtime global eagerly — a
 * plugin's `app.tsx` may be imported before the harness runs, so the global is
 * only ever published here, never consumed at module scope.
 */

export {
  createFakeKabmoHost,
  createFakeChamberHost,
  installTestPluginRuntime,
  uninstallTestPluginRuntime,
  NO_DEFAULT_EXPORT,
  type FakeKabmoFailure,
  type FakeKabmoHarness,
  type FakeKabmoHost,
  type FakeKabmoHostOptions,
  type FakeChamberHostOptions,
  type FakeChamberHost,
  type FakeChamberHarness,
  type FakeChamberFailure,
  type FakeRegistrations,
  type SlotName,
} from './fake-host';

export {
  createFakeSidebar,
  type FakeSidebar,
  type FakeSidebarHandle,
  type SidebarSnapshot,
} from './sidebar';

export {
  makeKabmoFetchResponse,
  makeChamberFetchResponse,
  makePanelContext,
  makePanelHostProps,
  makeUiKitServices,
  type FakeSessionHandle,
  type FakeUiKit,
  type FakeUiKitOptions,
} from './fixtures';
