/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Turning a command ID into a run: the scan, the merge, and the argv.
 *
 * Split out of `server.ts` when that file crossed the 350-line ceiling, and the
 * seam is real — this module is the RESOLUTION half (what a command id means,
 * what directory it runs in, what argv it becomes) while `server.ts` is the
 * registration half (the RPC surface, the log route, the registry's lifetime).
 *
 * ## The two command sources, and why they resolve differently
 *
 * A FILE command (`<file>#<kind>:<name>`) is re-resolved against a FRESH scan,
 * so an id the client invented has nothing to resolve to. A CUSTOM command
 * (`custom:<recordId>`) is re-resolved against the user's own STORAGE, by record
 * id — and that is what keeps `start` an id-based surface even though a custom
 * command is free text: the client cannot name a string to run, only a row the
 * user already saved.
 */

import { randomUUID } from 'crypto';
import { join } from 'path';

import { scanScope, resolveScope, type Scope } from './scan';
import { scopeKeyOf } from './run-store';
import type { RunRegistry } from './runner';
import {
  customGroupFor,
  customRecordIdOf,
  visibleIn,
  type CustomCommandStore,
} from './custom';
import type { Command, CommandListing } from '../protocol';

/** What a start request carries, once its scope has been validated. */
export interface StartInput {
  root: string;
  repo: string;
  sessionId: string | null;
  commandId: string;
  background: boolean;
}

/**
 * The scan, plus the user's own commands as their own group.
 *
 * The merge lives here rather than inside `scanScope` because the scan is a pure
 * filesystem walk and the custom half is a database read — one is testable
 * without a database, and a scan that silently needed storage would take both
 * with it.
 *
 * The custom group is ALWAYS first and always present (see `customGroupFor`), so
 * a repository with no command file still has the one row that can add a
 * command.
 *
 * A repo-scoped command is visible only under the root it was created for. The
 * comparison is on `root` (the workspace), not on `repo` (the picker's
 * sub-path): the panel's scope is a workspace plus a repository, and a command
 * saved while browsing `packages/api` belongs to the WORKSPACE — it names its own
 * directory in `cwd`.
 */
export async function withCustom(
  scope: Scope,
  store: CustomCommandStore,
): Promise<CommandListing | { error: string }> {
  const listing = scanScope(scope);
  if ('error' in listing) return listing;
  const group = customGroupFor(visibleIn(await store.list(), scope.root));
  return { ...listing, groups: [group, ...listing.groups] };
}

/** Resolve a command id against a fresh scan and start it. */
export async function startRun(
  registry: RunRegistry,
  store: CustomCommandStore,
  input: StartInput,
): Promise<{ runId: string } | { error: string }> {
  const dir = resolveScope({ root: input.root, repo: input.repo });
  if (!dir) return { error: 'That repository is not readable from this workspace.' };

  const recordId = customRecordIdOf(input.commandId);
  if (recordId) return startCustomRun(registry, store, dir, recordId, input);

  // A FRESH scan, so a command added since the panel's last read is runnable and
  // an id the client invented has nothing to resolve to.
  const listing = scanScope({ root: input.root, repo: input.repo });
  if ('error' in listing) return { error: listing.error };

  const found = findCommand(listing, input.commandId);
  if (!found) return { error: `No command "${input.commandId}" in this repository. Refresh the list.` };

  const cwd = found.group.cwd === '.' ? dir : join(dir, found.group.cwd);
  // The argv travels ON the row, built by the detector that found it — so the
  // label the user read and the command that runs cannot be two answers.
  const argv = found.command.argv;

  return registry.start({
    id: randomUUID(),
    sessionId: input.sessionId,
    scopeKey: scopeKeyOf(input.root, input.repo),
    commandId: input.commandId,
    file: found.group.file,
    cwd,
    argv,
    label: found.command.label,
    background: input.background,
  });
}

/**
 * Start one of the user's own commands.
 *
 * The text is read back from STORAGE by the record id, never taken from the
 * request — which is what keeps `start` an id-based surface even though a custom
 * command is free text. It runs as `sh -c <text>` because that is what the user
 * wrote (a pipe, a `&&`, a variable); the argv form cannot express any of it.
 *
 * The cwd is the scope's own directory joined with the stored RELATIVE path, so
 * a command saved while browsing `packages/api` runs there. An entry whose root
 * is another workspace is refused rather than run in this one: it would run the
 * right text in the wrong directory.
 */
async function startCustomRun(
  registry: RunRegistry,
  store: CustomCommandStore,
  dir: string,
  recordId: string,
  input: StartInput,
): Promise<{ runId: string } | { error: string }> {
  const entry = (await store.list()).find((candidate) => candidate.id === recordId);
  if (!entry) return { error: 'That command is no longer saved. Refresh the list.' };
  if (entry.scope === 'repo' && entry.root !== input.root) {
    return { error: 'That command belongs to another workspace.' };
  }

  const cwd = entry.cwd === '.' ? dir : join(dir, entry.cwd);

  return registry.start({
    id: randomUUID(),
    sessionId: input.sessionId,
    scopeKey: scopeKeyOf(input.root, input.repo),
    commandId: input.commandId,
    file: 'Custom commands',
    cwd,
    argv: ['sh', '-c', entry.command],
    label: entry.command,
    background: input.background,
  });
}

/** The group and command a command id names, or null. */
function findCommand(
  listing: CommandListing,
  commandId: string,
): { group: CommandListing['groups'][number]; command: Command } | null {
  for (const group of listing.groups) {
    for (const command of group.commands) {
      if (command.id === commandId) return { group, command };
    }
  }
  return null;
}
