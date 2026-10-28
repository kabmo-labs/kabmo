/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Files the operating system handed to Kabmo.
 *
 * A double-click in Finder, "Open With → Kabmo" on a `.docx`, a drop of three
 * PDFs on the Dock icon: all of them arrive as PATHS on the app's argv or in an
 * `application:openFiles:` callback, and the only layer that sees them is the
 * native shell. The page owns the tabs, so the paths cross to it as values.
 *
 * Two channels, because the two moments are different:
 *
 * - **A cold start** — the shell launches BECAUSE of the file, so the paths
 *   exist before the page does. They are injected as `window.__kabmoLaunchPaths`
 *   before the page's first script (the same way `__kabmoDesktop` is), and read
 *   once at boot.
 * - **A warm app** — the window is already on a console and the user opens
 *   another file. The shell calls `window.__kabmoOpenPaths([...])`.
 *
 * Both end in the same place: `consumeOpenPaths`, which asks the server to
 * grant the file's directory and then opens a tab. The grant is what makes this
 * work at all — a file in `~/Desktop` is outside every workspace, and the fs
 * routes refuse a root they do not recognise. `POST /api/fs/grant` is that
 * permission, and it is deliberately reached only from a gesture the OS
 * delivered.
 *
 * **A shell with no console yet buffers.** The window may be sitting on the
 * server picker, or on a console that has not finished loading; opening a tab
 * before a session exists has nowhere to put it. The listener is installed at
 * boot and the paths are re-delivered when a console appears, which is why
 * `deliver` is idempotent and why the queue is module-level.
 */

import { openFileInEditor } from '@/client/hooks/ui/open-file';
import { resolveOpenableFile } from '@/client/lib/fs/resolve-open';

/** The property a shell calls for a file opened while the app is running. */
export const OPEN_PATHS_PROPERTY = '__kabmoOpenPaths';

/** Where the last batch of paths went, for a diagnostic and for the tests. */
export interface OpenPathsOutcome {
  opened: string[];
  refused: { path: string; reason: string }[];
}

type PathHandler = (paths: string[]) => Promise<OpenPathsOutcome>;

const handlers = new Set<PathHandler>();
/** The handler `installOpenPaths` registered, so a second call replaces it. */
let installedHandler: PathHandler | null = null;
/** Paths that arrived before anything was listening (or before a console). */
let pending: string[] = [];

/**
 * The tab-opening half, kept as one function so the boot install and the tests
 * exercise the same code.
 *
 * It is installed by `main.tsx` rather than by this module at import time: the
 * import graph is what decides when `openFileInEditor` is reachable, and a
 * module-level side effect would make the order an accident.
 */
export async function openPathsNow(paths: string[]): Promise<OpenPathsOutcome> {
  const outcome: OpenPathsOutcome = { opened: [], refused: [] };
  for (const raw of paths) {
    const path = raw.trim();
    if (!path) continue;
    // The scope resolver owns the one retry a gesture earns: a file outside
    // every workspace is refused once, then granted (`resolve-open.ts`).
    const resolved = await resolveOpenableFile(path);
    if (!resolved.ok) {
      outcome.refused.push({ path, reason: resolved.message });
      continue;
    }
    openFileInEditor({ path: resolved.file.path, name: resolved.file.name, root: resolved.file.root });
    outcome.opened.push(path);
  }
  return outcome;
}

/**
 * Deliver paths to whoever is listening, or hold them until someone is.
 *
 * The shell may call this on a console that is still booting (the launch paths
 * are delivered by the shell as soon as the page's document exists, which can
 * be before hydration). Holding them is what makes the cold start work: the
 * listener registered at boot drains the queue in the same tick it registers.
 */
export function deliverOpenPaths(paths: string[]): void {
  const cleaned = paths.map((entry) => entry.trim()).filter(Boolean);
  if (cleaned.length === 0) return;
  if (handlers.size === 0) {
    // De-duplicated: a shell that delivers the same launch twice (a reload, a
    // second `open` before the page hydrated) must open one tab per file.
    pending = [...new Set([...pending, ...cleaned])];
    return;
  }
  for (const handler of handlers) void handler(cleaned);
}

/** Drain what arrived before a listener existed. */
export function drainPendingOpenPaths(): string[] {
  const paths = pending;
  pending = [];
  return paths;
}

/**
 * Register a handler and take whatever was waiting.
 *
 * Returns the unsubscribe, so a hot reload cannot accumulate handlers that open
 * the same file several times.
 */
export function onOpenPaths(handler: PathHandler): () => void {
  handlers.add(handler);
  const waiting = drainPendingOpenPaths();
  if (waiting.length > 0) void handler(waiting);
  return () => handlers.delete(handler);
}

/**
 * Install the global a shell calls, and register the tab opener.
 *
 * Idempotent, and installed unconditionally: the property is inert in a browser
 * (nothing calls it), and gating on a user agent would be a second place that has
 * to know which shells exist.
 *
 * `onResult` is told about EVERY batch, not only a refused one: a batch of three
 * files can open two and refuse one, and a reporter that only heard about
 * failures could not say what happened. The DEFAULT reporter warns about the
 * refusals and says nothing about the rest, because the console has no toast
 * stack at this level — the tab that opened is its own feedback.
 */
export function installOpenPaths(
  options: { onResult?: (outcome: OpenPathsOutcome) => void } = {},
): void {
  if (typeof window === 'undefined') return;
  const host = window as unknown as Record<string, unknown>;
  host[OPEN_PATHS_PROPERTY] = (paths: unknown) => {
    if (Array.isArray(paths)) deliverOpenPaths(paths.filter((entry): entry is string => typeof entry === 'string'));
  };

  // Replacing rather than adding: a second install would open every file twice,
  // and the doc above promises idempotence.
  if (installedHandler) handlers.delete(installedHandler);
  installedHandler = async (paths) => {
    const outcome = await openPathsNow(paths);
    const report = options.onResult ?? ((result: OpenPathsOutcome) => {
      for (const refusal of result.refused) console.warn(`[kabmo] ${refusal.path}: ${refusal.reason}`);
    });
    report(outcome);
    return outcome;
  };
  onOpenPaths(installedHandler);
}
