/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The host services the kit reads, and the seam that installs them.
 *
 * `@ompchamber/ui` is a published package, so it cannot import the chamber's own
 * source. The host therefore INJECTS its services once at boot via
 * `configureUiKit`, and every hook in this package reads them from here.
 *
 * Each field is something a plugin genuinely cannot do itself: read the
 * chamber's per-session store, know the live palette, resolve the active
 * workspace, or render the chamber's markdown pipeline. Anything a plugin could
 * read from the DOM it should read from the DOM.
 */

import type { ComponentType } from 'preact';
import type { SidebarThread, SidebarThreadActions } from '@ompchamber/plugin-sdk';

/** What the host seeds every plugin component with. */
export interface PanelContext {
  sessionId: string | null;
  workspacePath: string | null;
  theme: string;
}

/**
 * The props a panel BODY is rendered with.
 *
 * A built-in view and a plugin panel receive the SAME shape from the same
 * catalog, so this type is the contract both sides compile against. Every field
 * but the three the layout always knows is optional: a view ignores what it does
 * not use, and a plugin registered for the right panel may ignore all of them
 * and read `usePanelInfo()` instead.
 */
export interface PanelHostProps {
  /** The active session id, or null. */
  sessionId?: string | null;
  /** False when the view has nothing to read — no workspace, or it is hidden. */
  enabled: boolean;
  /** True while this is the view on screen. */
  active: boolean;
  /** Bumped after a write, so a tree/list view re-reads. */
  refreshKey: number;
  /** The active workspace root, when there is one. */
  rootPath?: string;
  onRefresh?: () => void;
  onOpenFile?: (file: unknown) => void;
  onClose?: () => void;
  /** The phone's drawer hides a view's own header; the desktop stack does not. */
  showHeader?: boolean;
}

/**
 * Props for the chamber's markdown renderer, injected as a component.
 *
 * The renderer is NOT bundled into the kit: it pulls the chamber's own marked /
 * KaTeX / mermaid / Shiki pipeline and the host's file-opening and clipboard
 * hooks, which is a large tree a plugin must not carry twice. The host hands the
 * kit the component instead, so a wiki page or a plan reads exactly like the
 * chat timeline without the kit owning any of that machinery.
 */
export interface HostMarkdownProps {
  content: string;
  className?: string;
}

/** The host's own services, injected once. */
export interface UiKitServices {
  /** The current panel context. */
  context(): PanelContext;
  /** Subscribe to context changes (a new session, a palette switch). */
  subscribe(listener: (context: PanelContext) => void): () => void;
  /** Read one per-session value. */
  getSessionValue(sessionId: string | null, key: string): string | null;
  /** Write one per-session value. */
  setSessionValue(sessionId: string | null, key: string, value: string): void;
  /**
   * Subscribe to writes of ONE per-session value, from any component.
   *
   * Optional so a host built before this seam still runs a newer kit — the
   * hook degrades to read-on-mount, which is what every host did.
   *
   * It exists because `getSessionValue` alone makes two readers of one key
   * disagree: a component reads the store once and then holds its own copy, so
   * a field that WRITES a value and a readout that DISPLAYS it are two private
   * copies of the same fact, and the readout keeps the value it read at mount
   * forever.
   */
  subscribeSessionValue?(sessionId: string | null, key: string, listener: () => void): () => void;
  /**
   * Typed per-session state, for a view that stores more than a string.
   *
   * `useSessionValue` covers the common case (a note, a path); a collapsed-phase
   * map or a picked file is not a string, and JSON-encoding it into one would
   * make every reader parse it back. These three are the same store, untyped by
   * the kit and narrowed by the caller.
   *
   * Optional so an older host still runs: `useSessionState` then answers its
   * fallback and never persists, which is honest about a host that cannot.
   */
  getSessionJson?<T>(sessionId: string | null, key: string): T | undefined;
  setSessionJson?(sessionId: string | null, key: string, value: unknown): void;
  subscribeSessionJson?(sessionId: string | null, key: string, listener: () => void): () => void;
  /** Read a text file inside the active workspace. Rejects with the reason. */
  readWorkspaceFile(workspacePath: string | null, relativePath: string): Promise<string>;
  /** The chamber's markdown renderer, so a plugin does not bundle a second one. */
  markdown?(): ComponentType<HostMarkdownProps> | null;

  // -------------------------------------------------------------------------
  // The participant seam: what lets a plugin act on the conversation, not only
  // draw beside it.
  // -------------------------------------------------------------------------

  /**
   * Call one of a plugin's server methods.
   *
   * `pluginId` is the FIRST argument and the kit supplies it from the Preact
   * context of the subtree the call was made in — so a plugin never names its
   * own namespace, and a component rendered for plugin A cannot reach plugin B.
   * The host is the one party that cannot be wrong about which plugin it is
   * running.
   *
   * The result is the WIRE shape the route answers with: `{ ok: true, value }`
   * or `{ ok: false, error }` at HTTP 200, because a plugin's own refusal is a
   * value rather than a transport failure. A hook that flattened the two would
   * turn "the plugin said no" into "the network broke", which is the one
   * distinction the route exists to preserve.
   */
  callRpc?(pluginId: string, method: string, input: unknown): Promise<PluginRpcOutcome>;
  /** Subscribe to a plugin's own realtime topic. Returns an unsubscribe. */
  subscribePluginTopic?(pluginId: string, listener: (value: unknown) => void): () => void;
  /** The plugin's topic value as it stands, for a first render before a frame. */
  readPluginTopic?(pluginId: string): unknown;
  /** Ask the server for a fresh snapshot of the plugin's topic. */
  refreshPluginTopic?(pluginId: string): void;
  /** Whether the value on hand is not known to be current. */
  pluginTopicStale?(pluginId: string): boolean;

  /**
   * The composer's live state and its writes.
   *
   * `write` goes through the SAME state the chat owns, not the DOM: the
   * composer is a controlled textarea, so a DOM write is reverted by the next
   * keystroke and the plugin's edit vanishes with no error.
   */
  composer?(): ComposerService;
  /** Subscribe to composer changes (a keystroke, a run starting, a send). */
  subscribeComposer?(listener: (state: ComposerState) => void): () => void;

  /**
   * The sidebar's sessions, as the host's own sidebar holds them.
   *
   * A projection rather than a second fetch: a plugin sees exactly what the
   * sidebar beside it sees, including a run in flight, so the two cannot
   * disagree. Returns the current value and a subscription for pushes.
   */
  sidebarThreads?(): { value: SidebarThread[]; stale: boolean };
  subscribeSidebarThreads?(listener: (state: { value: SidebarThread[]; stale: boolean }) => void): () => void;
  /** Ask the host for a fresh sidebar snapshot. */
  refreshSidebarThreads?(): void;
  /**
   * The session actions, injected as a service.
   *
   * The host owns the writes because they go through its own routes — there is
   * no second session store, so a plugin's rename and the sidebar's own inline
   * editor cannot drift.
   */
  sidebarActions?(): SidebarThreadActions;

  // -------------------------------------------------------------------------
  // The repo scope: the nested repository the right-panel views operate on.
  // -------------------------------------------------------------------------

  /**
   * The nested-repo scope the workspace panels share, as it stands.
   *
   * The host owns this value: it is a path RELATIVE to the active workspace
   * root (`projects/api`), validated by the host's own routes, and the Files,
   * Search, Source Control and Terminal panels all read and write the SAME
   * slot. A plugin that reads it therefore describes the tree those panels
   * describe, and a write moves them — which is the whole point of exposing it
   * rather than letting a plugin keep its own picker.
   *
   * It is a SERVICE rather than `useSessionState('workspace.activeRepo')`
   * because the kit's session services carry a `plugin.` prefix (a plugin's
   * keys live in its own namespace), so the shared slot is unreachable from
   * them. And the stored value is a `{ root, repo }` PAIR, not a bare string:
   * the root it was picked under is part of its meaning, and resolving it here
   * is what keeps a plugin from showing another workspace's repo.
   *
   * Optional, like every additive service: a host built before this seam still
   * runs a newer kit, and the hook then reports no scope rather than throwing.
   */
  repoScope?(): RepoScope;
  /** Set the shared pick. `repo` is root-relative; `'.'` means the root itself. */
  setRepoScope?(repo: string): void;
  /**
   * Subscribe to scope changes. Returns an unsubscribe.
   *
   * Fires for a pick AND for a session or workspace change, because the slot is
   * per-session: switching sessions changes the effective scope while the stored
   * key is untouched, so a subscriber wired only to the key would keep reporting
   * the previous session's repo.
   */
  subscribeRepoScope?(listener: () => void): () => void;
  /** Force a fresh nested-repo walk for the current root (the picker's ⟳). */
  rescanRepoScope?(): void;
}

/**
 * One row of the repo picker.
 *
 * The LABELS travel with the row rather than being derived in the kit, because
 * the naming rule is the host's: `.` reads as the workspace folder's own name,
 * a list row keeps its whole root-relative path (so `jns6_5/token` and
 * `jns7/token` are distinguishable), and a trigger truncates to the last
 * segment. The kit is a published package that cannot import the host's
 * `repo-label` module, and a second copy of those three rules is exactly how one
 * repo comes to be labelled two ways in two places.
 */
export interface RepoScopeRow {
  /** The root-relative path — what a selection sends back. `'.'` is the root. */
  repo: string;
  /** What the row reads in the list. */
  label: string;
  /** The short form for the trigger, where the space is a few characters. */
  short: string;
}

/**
 * The nested-repo scope, as a plugin sees it.
 *
 * `rows` always contains the root itself (`'.'` first), because browsing the
 * workspace root is legitimate even when it is not a repository — a folder of
 * nested repos is a normal workspace.
 */
export interface RepoScope {
  /** The active workspace root, or null when there is none. */
  root: string | null;
  /** The picked repo, root-relative. `'.'` is the root. */
  repo: string;
  /** Every choice, `'.'` first, then discovery's order. */
  rows: RepoScopeRow[];
  /** Discovery is still running — the picker's refresh spins. */
  scanning: boolean;
  /** False until the session's stored state has loaded, so a picker can hold. */
  ready: boolean;
}

/**
 * One RPC call's failure, as the wire carries it.
 *
 * `issues` is the schema's own report, passed through so a plugin can render
 * which argument was wrong rather than only that something was.
 */
export interface PluginRpcError {
  code: string;
  message: string;
  issues?: readonly { message: string; path?: readonly (string | number)[] }[];
}

/**
 * One RPC call's outcome, mirroring the wire exactly.
 */
export type PluginRpcOutcome = { ok: true; value: unknown } | { ok: false; error: PluginRpcError };

/** What a plugin may read of the composer. */
export interface ComposerState {
  /** The draft as it stands. */
  text: string;
  isEmpty: boolean;
  /** A run is in flight, so a send-like action should disable itself. */
  isSubmitting: boolean;
  /** Where this composer writes: a session's chat, or a not-yet-created one. */
  scope: { kind: 'session' | 'new'; sessionId: string | null };
}

/** The composer's writes, for a plugin that drives it rather than reading it. */
export interface ComposerService extends ComposerState {
  /** Replace the draft. */
  set(text: string): void;
  /** Insert at the caret, leaving the rest of the draft alone. */
  insert(text: string): void;
  focus(): void;
}

let services: UiKitServices | null = null;

/** Called ONCE by the host at boot. A plugin must never call this. */
export function configureUiKit(next: UiKitServices): void {
  services = next;
}

export function requireServices(): UiKitServices {
  if (!services) {
    throw new Error(
      'The OMPChamber UI kit has no host services — this component must be rendered by the OMPChamber app.',
    );
  }
  return services;
}

/** The host services as they stand, or null outside the app. */
export function uiKitServices(): UiKitServices | null {
  return services;
}
