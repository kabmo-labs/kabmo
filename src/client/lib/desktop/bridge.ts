/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The desktop shell's bridge, and the reason every other module asks this one
 * whether it is running inside the shell.
 *
 * THREE shells install the same transport, and that is the point of this module:
 *
 * - `packages/macos` (macOS, Swift + WKWebView)
 * - `packages/windows` (.NET + WPF + WebView2)
 * - `packages/linux` (Rust + GTK 3 + WebKitGTK 4.1)
 *
 * Each installs ONE transport before the page's own scripts run:
 * `window.__kabmoCall(method, params)` posts `{ id, method, params }` to a host
 * message handler named `kabmo`, and the shell answers by evaluating
 * `window.__kabmoReply(id, ok, payload)`. There is no capability file and no
 * per-origin allowance — the shell owns the webview, so the page cannot be
 * anything but one this window chose to load.
 *
 * This module must be safe in a BROWSER too: every function rejects with "not
 * inside the shell" when there is no bridge, and the navbar draws no server
 * control at all. A browser tab has no shell to control, and a control that
 * opened onto "not available" would be a button that never works.
 */

/** What the shell reports about itself. */
export interface DesktopInfo {
  platform: string;
  shellVersion: string;
  /**
   * The machine's architecture, in the canonical vocabulary (`arm64` / `x64`).
   *
   * Every desktop artifact is per-architecture, so without this the console can
   * only offer the release page. Absent on a shell too old to report it, which
   * degrades the offer to that page rather than breaking it.
   */
  arch?: string;
  /** True when the shell hides the native title bar and the page draws it. */
  overlayTitlebar: boolean;
  /**
   * macOS: the width of the traffic lights, which float over the page's LEFT
   * edge. Absent on a platform whose window controls are not on the left.
   */
  trafficLightInset?: string;
  /**
   * True when the shell is borderless and has NO controls of its own, so the
   * page must draw minimise / maximise / close.
   *
   * Windows and Linux. macOS gets its traffic lights from the system over a
   * full-size content view; a borderless Windows window has nothing at all, and
   * the webview there is an HWND — a WPF element cannot be drawn on top of it
   * (the airspace problem) — so the page is the only surface that can. Linux
   * could draw native buttons in a `GtkOverlay` (measured: an overlay child does
   * receive clicks over a WebView), but the page's set already exists, is tested,
   * and is the one every other shell's users see.
   */
  windowControls?: boolean;
}

/** One server in the shell's list, or one found on this machine. */
export interface DesktopServer {
  id: string;
  label: string;
  url: string;
  kind: 'remote' | 'managed';
  port?: number;
  running: boolean;
  /** This shell started it (as opposed to a server found on the machine). */
  owned: boolean;
  version?: string;
  mode?: string;
  pid?: number;
  startedAt?: string;
  /** `stored` for the list, `record` for a local instance found on disk. */
  source: 'stored' | 'record';
}

export interface DesktopServersState {
  entries: DesktopServer[];
  /** Local instances this shell did NOT start — a `kabmo serve`, a dev server. */
  detected: DesktopServer[];
  activeId?: string;
  activeUrl?: string;
}

declare global {
  interface Window {
    __kabmoCall?: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
    __kabmoDesktop?: DesktopInfo;
    __kabmoReply?: (id: number, ok: boolean, payload: unknown) => void;
  }
}

/** True when this page is inside the desktop shell. */
export function isDesktopShell(): boolean {
  return typeof window !== 'undefined' && typeof window.__kabmoCall === 'function';
}

async function call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  const invoke = typeof window === 'undefined' ? undefined : window.__kabmoCall;
  if (!invoke) throw new Error('Not running inside the Kabmo desktop shell.');
  return (await invoke(method, params)) as T;
}

export function desktopInfo(): Promise<DesktopInfo | null> {
  if (!isDesktopShell()) return Promise.resolve(null);
  const injected = typeof window === 'undefined' ? undefined : window.__kabmoDesktop;
  // The shell injects this before the page's first script, so the navbar's first
  // paint is already correct; the command is only a fallback for a shell that
  // did not (an older build).
  if (injected) return Promise.resolve(injected);
  return call<DesktopInfo>('desktop_info');
}

export function readServers(): Promise<DesktopServersState> {
  return call<DesktopServersState>('servers_state');
}

export function addRemoteServer(label: string, url: string): Promise<DesktopServersState> {
  return call<DesktopServersState>('servers_add', { label, url });
}

export function removeServer(id: string): Promise<DesktopServersState> {
  return call<DesktopServersState>('servers_remove', { id });
}

/** Point the window at a server. The shell navigates, so this page goes away. */
export function activateServer(id: string): Promise<DesktopServersState> {
  return call<DesktopServersState>('servers_activate', { id });
}

/** Start a local server as the shell's child, then navigate to it. */
export function startLocalServer(port?: number, label?: string): Promise<DesktopServersState> {
  return call<DesktopServersState>('servers_start', { port: port ?? null, label: label ?? null });
}

export function stopLocalServer(id: string): Promise<DesktopServersState> {
  return call<DesktopServersState>('servers_stop', { id });
}

/**
 * A refused command's message.
 *
 * The shell sends its own sentence (a refused URL, a server that exited), which
 * is what the UI shows. Nothing is stripped: a message that genuinely starts with
 * "Error" would lose its first word.
 */
export function bridgeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Minimise, maximise/restore and close, for a shell that draws no controls. */
export function windowMinimize(): Promise<void> {
  return call<void>('window_minimize');
}

export function windowToggleMaximize(): Promise<void> {
  return call<void>('window_maximize');
}

export function windowClose(): Promise<void> {
  return call<void>('window_close');
}

/**
 * What the shell did with an update it was handed.
 *
 * The shell owns the whole run — download, verify, replace, relaunch — because
 * only it can do any of those things: a page cannot replace the executable it is
 * running inside, and a page's "download" leaves a file in a folder the user has
 * to find. This is the report it sends back.
 *
 * `relaunching` is the honest terminal state on success: the shell is about to
 * quit, so a caller that keeps a spinner going is describing a page that is
 * already gone.
 */
export interface ShellUpdateOutcome {
  success: boolean;
  /** The version the shell installed, when it could read one. */
  version?: string | null;
  /** A sentence for the user — the shell's own, never a generic failure. */
  message: string;
  relaunching?: boolean;
}

/**
 * Ask the shell to install the build it just offered.
 *
 * `url` and `version` are the console's answer, passed through rather than
 * re-derived: the shell has no release list of its own, and asking it to fetch
 * one would be a second reader of the same GitHub endpoint.
 *
 * The shell VERIFIES the bytes before installing them (the platform's own check —
 * a code signature, an archive shape, a version floor). A console that is
 * compromised can therefore make the shell download, but not make it run
 * something the platform will not vouch for.
 */
export function applyShellUpdate(url: string, version: string): Promise<ShellUpdateOutcome> {
  return call<ShellUpdateOutcome>('update_apply', { url, version });
}
