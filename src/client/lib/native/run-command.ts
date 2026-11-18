/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The console's command catalog, published for the NATIVE shell that hosts it.
 *
 * A shell's menu bar can only report a click; every command it would offer lives
 * in the page (`shared/lib/commands/catalog.ts`), because that is the one place
 * a chord, a title and a `when` condition are stated. Duplicating those rows
 * natively would be a second source of truth that drifts — and a native row that
 * also DECLARED a key equivalent would steal the chord from the page's own
 * dispatcher before it ever saw the keystroke.
 *
 * So the menu row carries no chord and asks here instead:
 *
 *     window.__kabmoRunCommand('workspace.toggleSidebar')
 *
 * The same indirection as `__kabmoBack`, `__kabmoResume` and `__kabmoOpenPaths`
 * — the page owns the state and the catalog, the shell only knows the moment.
 * Installed unconditionally: inert in a browser (nothing calls it), and gating on
 * a user agent would be a second place that has to know which shells exist.
 *
 * A command that is not registered answers `false` rather than throwing: a menu
 * row is not a place to surface `command "…" is already registered`, and the
 * shell's caller can decide to stay quiet.
 */

import { runCommand } from '@/client/lib/commands/registry';

/** The property a shell calls. Named once so both sides agree. */
export const RUN_COMMAND_PROPERTY = '__kabmoRunCommand';

/**
 * Run one catalog command by id, with optional arguments.
 *
 * Exported for tests and for any in-page caller that wants the same contract
 * without the global — the property is only the transport.
 */
export function dispatchRunCommand(id: unknown, args?: unknown): boolean {
  if (typeof id !== 'string') return false;
  const command = id.trim();
  if (!command) return false;
  return runCommand(command, args);
}

/** Install `window.__kabmoRunCommand`. Idempotent — a hot reload re-runs it. */
export function installCommandRunner(): void {
  if (typeof window === 'undefined') return;
  (window as unknown as Record<string, unknown>)[RUN_COMMAND_PROPERTY] = dispatchRunCommand;
}
