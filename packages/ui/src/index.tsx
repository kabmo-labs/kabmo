/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The UI kit a plugin renders with, and the host services it reads through.
 *
 * Everything here runs IN THE HOST'S TREE — same Preact instance, same
 * document, same theme — so the kit is plain Preact components, not a
 * message-passing client. What it still must not do is reach into the host's
 * own source: this is a published package, so the host INJECTS its services
 * once at boot via `configureUiKit`, and the hooks read them.
 *
 * Two rules the hooks exist to enforce, because a plugin gets them wrong:
 *
 * - **Context arrives late.** The active session and workspace are resolved
 *   asynchronously, so a component that captured them once would show "none"
 *   over a real workspace. Every hook subscribes and re-renders.
 * - **Session state is not component state.** The component is unmounted when
 *   its panel is hidden, so a value kept in `useState` alone would be lost on
 *   every tab switch. `useSessionValue` reads the chamber's store.
 *
 * The surface is split across modules by what it is FOR, so a consumer imports
 * the piece it needs rather than one growing file:
 *
 * | Module | What it holds |
 * |---|---|
 * | `./services` | The injected services and the prop contracts |
 * | `./panels` | `usePanelInfo`, `usePanelHost`, `useSessionValue`, `useWorkspaceFile` |
 * | `./fetch` | `useChamberFetch` — a plugin's own read of the chamber's HTTP API (poll + events) |
 * | `./participant` | `useRpc`, `useRealtime`, `useComposer` — what lets a plugin ACT on the conversation |
 * | `./components` | The presentation kit (`Panel`, `Field`, `Button`, …) |
 */

export type {
  PanelContext,
  PanelHostProps,
  HostMarkdownProps,
  UiKitServices,
  PluginRpcError,
  PluginRpcOutcome,
  ComposerState,
  ComposerService,
} from './services';
export { configureUiKit, uiKitServices, requireServices } from './services';

export {
  usePanelInfo,
  useTheme,
  useSessionValue,
  useSessionState,
  useWorkspaceFile,
  type SessionValue,
  type WorkspaceFile,
} from './panels';

export { PanelHostProvider, usePanelHost } from './panel-host';
export { PluginIdProvider, usePluginId } from './plugin-id';

export { useChamberFetch, DEFAULT_POLL_MS, type ChamberFetchOptions, type ChamberFetchState } from './fetch';

export {
  useRpc,
  useRealtime,
  useComposer,
  type RpcState,
  type PluginRealtimeState,
  type ComposerHandle,
} from './participant';

export { experimental_useSidebarThreads, experimental_useSidebarThreadActions } from './sidebar';

export * from './components';
