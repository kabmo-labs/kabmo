/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The commands only the DESKTOP shells answer: their identity, their window
 * verbs, and installing their own update.
 *
 * A phone has none of these. It draws no window chrome (its buttons are the
 * system's), it cannot replace the app it runs inside, and its identity arrives
 * on the User-Agent rather than over a bridge. Keeping them out of
 * `transport.ts` is what lets that module stay about one question — "which shell
 * is this?" — instead of about every verb five shells do not share.
 */

import { callShell, isDesktopShell } from '@/client/lib/shell/transport';

/** What the desktop shells report about themselves. */
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
   * True when the shell is borderless and has NO controls of its own, so the page
   * must draw minimise / maximise / close.
   *
   * Windows and Linux. macOS gets its traffic lights from the system over a
   * full-size content view; a borderless Windows window has nothing at all, and
   * the webview there is an HWND — a WPF element cannot be drawn on top of it
   * (the airspace problem) — so the page is the only surface that can. Linux could
   * draw native buttons in a `GtkOverlay` (measured: an overlay child does receive
   * clicks over a WebView), but the page's set already exists, is tested, and is
   * the one every other shell's users see.
   */
  windowControls?: boolean;
}

declare global {
  interface Window {
    __kabmoDesktop?: DesktopInfo;
  }
}

export function desktopInfo(): Promise<DesktopInfo | null> {
  if (!isDesktopShell()) return Promise.resolve(null);
  const injected = typeof window === 'undefined' ? undefined : window.__kabmoDesktop;
  // The shell injects this before the page's first script, so the navbar's first
  // paint is already correct; the command is only a fallback for a shell that did
  // not (an older build).
  if (injected) return Promise.resolve(injected);
  return callShell<DesktopInfo>('desktop_info');
}

/** Minimise, maximise/restore and close, for a shell that draws no controls. */
export function windowMinimize(): Promise<void> {
  return callShell<void>('window_minimize');
}

export function windowToggleMaximize(): Promise<void> {
  return callShell<void>('window_maximize');
}

export function windowClose(): Promise<void> {
  return callShell<void>('window_close');
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
 * re-derived: the shell has no release list of its own, and asking it to fetch one
 * would be a second reader of the same GitHub endpoint.
 *
 * The shell VERIFIES the bytes before installing them (the platform's own check —
 * a code signature, an archive shape, a version floor). A console that is
 * compromised can therefore make the shell download, but not make it run
 * something the platform will not vouch for.
 */
export function applyShellUpdate(url: string, version: string): Promise<ShellUpdateOutcome> {
  return callShell<ShellUpdateOutcome>('update_apply', { url, version });
}
