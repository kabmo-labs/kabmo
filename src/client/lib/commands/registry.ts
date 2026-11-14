/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The command implementations: id → the closure that runs it.
 *
 * Kept apart from the catalog (`shared/lib/commands/catalog.ts`) because the
 * catalog is data a server-rendered shell can read, while an implementation is
 * a DOM closure. A command may be listed without an implementation (a plugin
 * that failed to load) and the palette says so rather than offering a row that
 * does nothing.
 *
 * The store lives on `globalThis` for the same reason every other registry
 * here does: `bun --hot` re-evaluates this module while mounted components
 * still hold the disposers they were handed.
 */

export type CommandRunner = (args?: unknown) => void | Promise<void>;

interface RegistryState {
  runners: Map<string, CommandRunner>;
  listeners: Set<() => void>;
}

declare global {
  // eslint-disable-next-line no-var
  var __kabmoCommandRegistry: RegistryState | undefined;
}

function state(): RegistryState {
  return (globalThis.__kabmoCommandRegistry ??= { runners: new Map(), listeners: new Set() });
}

function publish(): void {
  for (const listener of [...state().listeners]) listener();
}

/**
 * Register one implementation. A duplicate id THROWS: two owners for one
 * command is a bug, and a quiet overwrite would make the first unreachable.
 */
export function registerCommand(id: string, run: CommandRunner): () => void {
  const runners = state().runners;
  if (runners.has(id)) throw new Error(`command "${id}" is already registered`);
  runners.set(id, run);
  publish();
  return () => {
    if (runners.delete(id)) publish();
  };
}

/** Run a command. Returns false when nothing is registered for the id. */
export function runCommand(id: string, args?: unknown): boolean {
  const run = state().runners.get(id);
  if (!run) return false;
  void run(args);
  return true;
}

export function hasCommand(id: string): boolean {
  return state().runners.has(id);
}

export function subscribeCommands(listener: () => void): () => void {
  state().listeners.add(listener);
  return () => state().listeners.delete(listener);
}
