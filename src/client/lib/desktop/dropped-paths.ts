/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The paths the SHELL saw in a drag, for a webview that gives the page none.
 *
 * A Finder drag onto a `WKWebView` hands the page BYTES and nothing else.
 * Measured on macOS 27 with a real `NSFilenamesPboardType` + `public.file-url`
 * pasteboard: at `drop` the payload is `types: ["Files"]`, `files: [File]`,
 * `getData('text/uri-list')` and `getData('text/plain')` both empty, and `File`
 * carries no `path` property. So neither of the editor's open routes can fire:
 *
 * - `DataTransferItem.getAsFileSystemHandle` is `undefined` in WKWebView — the
 *   File System Access API is not implemented by WebKit (bug 257792 is open) —
 *   so there is no handle to read or write through.
 * - There is no URI list. WebKit stopped adding local filenames as URLs to a
 *   file drag on macOS (WebKit changeset 222257), which is exactly the payload
 *   `/api/fs/scope` would need.
 *
 * A Finder drag on the macOS shell therefore ended at "That drop carried no
 * readable file — drop it on the composer to attach it instead": the chat
 * composer worked (it only needs bytes) and the editor did not (it needs a
 * path). The Linux shell never had the bug — WebKitGTK preloads
 * `text/uri-list` for a file-manager drag — and neither does the Windows one,
 * where WebView2 is Chromium and `getAsFileSystemHandle` is available.
 *
 * The shell is the only layer that HAS the path, so it reads its pasteboard
 * before the page's `drop` fires and answers `dropped_paths` with what it saw.
 *
 * Two rules, both about a value that outlives its gesture:
 *
 * - **Reading CONSUMES it** (in the shell). One drop opens one file, and a drop
 *   whose handler never asked must not open the previous file.
 * - **A stale value is ignored.** A drop released where no target claimed it
 *   leaves the paths unread; the age check keeps that leftover from opening the
 *   wrong file later. The clock is the shell's own, and it runs on this machine.
 */

import { isDesktopShell } from '@/client/lib/desktop/bridge';

/** What the shell answers with. */
export interface ShellDroppedPaths {
  /** Absolute paths, in the pasteboard's own order. */
  paths: string[];
  /** The shell's clock, in milliseconds. */
  at: number;
}

/**
 * How long a captured drop stays usable.
 *
 * The page asks in the same turn the drop is delivered, so anything older is a
 * leftover rather than this gesture. Generous enough for a busy main thread
 * without letting one drop leak into the next.
 */
export const SHELL_DROP_TTL_MS = 2_000;

/**
 * The paths the shell captured for the drop being handled, or `[]`.
 *
 * Resolves `[]` in a browser, in a shell too old to answer, and when the answer
 * is stale — all three mean the same thing to the caller: there is nothing to
 * add, so the drop's own payload decides.
 */
export async function readShellDroppedPaths(
  now: number = Date.now(),
): Promise<string[]> {
  if (!isDesktopShell()) return [];
  const invoke = typeof window === 'undefined' ? undefined : window.__kabmoCall;
  if (!invoke) return [];
  let answer: unknown;
  try {
    answer = await invoke('dropped_paths');
  } catch {
    return [];
  }
  const captured = answer as ShellDroppedPaths | null;
  if (!captured || !Array.isArray(captured.paths) || captured.paths.length === 0) return [];
  if (!Number.isFinite(captured.at) || Math.abs(now - captured.at) > SHELL_DROP_TTL_MS) return [];
  return captured.paths.filter((entry) => typeof entry === 'string' && entry.trim().length > 0);
}
