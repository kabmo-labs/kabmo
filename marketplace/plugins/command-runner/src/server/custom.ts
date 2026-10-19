/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The user's own commands, in the plugin's own storage.
 *
 * ## Where they live, and why
 *
 * `api.storage.records` — the plugin platform's record table — NOT Kabmo's
 * `app_settings` and NOT `localStorage`:
 *
 * - **The host already owns a namespace for this.** `plugin_records` is keyed by
 *   `(plugin_id, collection, id)` and the plugin id is bound by the HOST at load
 *   (`storage.server.ts`), so a plugin holds no string it could point at another
 *   plugin's rows. "Namespacing" is a property of the call signature rather than
 *   a check that could be forgotten.
 * - **`app_settings` is the host's.** Writing a plugin's rows there would put
 *   them in Kabmo's own settings namespace, where a future host migration
 *   owns them and a user's Kabmo upgrade could rewrite them.
 * - **`localStorage` cannot work.** The runner is the SERVER: it resolves a
 *   command id to an argv, so the list has to be readable server-side. A
 *   browser-only store would leave the panel able to draw a row it cannot run.
 *
 * ## One collection, the scope in the key
 *
 * A single `commands` collection whose id is `<rootKey>:<slug>`. A second
 * collection for repo-scoped entries would mean every read is two reads and
 * every write has to choose — while the scope is already part of what identifies
 * a command, so it belongs in the key.
 *
 * The root key is a short digest of the workspace root rather than the path
 * itself: a path contains `/` and can be long, and a record id is a single
 * column. It stays DETERMINISTIC (same root, same key) so a command written
 * today is found tomorrow without storing a lookup table.
 */

import type { KabmoPluginApi, PluginJson } from '@kabmo-labs/kabmo-sdk';

import type { Command, CommandGroup, CustomCommand, CustomScope } from '../protocol';

/** The one collection these rows live in. */
const COLLECTION = 'commands';

/**
 * A short, stable key for a workspace root.
 *
 * FNV-1a over the resolved path, hex-encoded. Not a security hash — it only has
 * to make two roots collide so rarely that a collision is not a design concern,
 * and it keeps a record id to one column.
 */
export function rootKey(root: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < root.length; i += 1) {
    hash ^= root.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * The slug a command is addressed by.
 *
 * Lowercased, whitespace collapsed to `-`, and anything outside a conservative
 * set dropped — so `Deploy Staging` and `deploy   staging` are the SAME command
 * and a user editing one does not silently create a second. An empty result is
 * refused by the caller rather than stored, because an id of `root:` would make
 * two different commands overwrite each other.
 */
export function commandSlug(command: string): string {
  return command
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

/** The record id for a command: scope, root and slug. */
export function commandRecordId(scope: CustomScope, root: string | null, slug: string): string {
  return `${scope === 'global' ? 'g' : rootKey(root ?? '')}:${slug}`;
}

/**
 * The commands visible in one scope.
 *
 * A `repo` command is returned only for the root it was created under; a
 * `global` one is returned everywhere. That is the whole difference between the
 * two scopes, and it is applied HERE rather than in the panel so the runner and
 * the list cannot disagree about what is visible.
 */
export function visibleIn(commands: readonly CustomCommand[], root: string | null): CustomCommand[] {
  return commands.filter((entry) => entry.scope === 'global' || entry.root === root);
}

/**
 * The store, over the plugin's own record API.
 *
 * Every method reads or writes through `api.storage.records`, so nothing here
 * holds state between calls: the database is the single answer, and a reload or
 * a second tab sees the same list.
 */
export class CustomCommandStore {
  private readonly api: KabmoPluginApi;

  constructor(api: KabmoPluginApi) {
    this.api = api;
  }

  /** Every stored command, global first then repo-scoped, each group by creation. */
  async list(): Promise<CustomCommand[]> {
    const rows = await this.api.storage.records.list<CustomCommand>(COLLECTION, { limit: 500 });
    const commands = rows.map((row) => row.data).filter(isCustomCommand);
    commands.sort((a, b) => {
      if (a.scope !== b.scope) return a.scope === 'global' ? -1 : 1;
      return a.createdAt - b.createdAt;
    });
    return commands;
  }

  /** The commands visible under one root. */
  async listFor(root: string | null): Promise<CustomCommand[]> {
    return visibleIn(await this.list(), root);
  }

  /**
   * Create or replace a command.
   *
   * Replacing is by SLUG within a scope, so re-saving `deploy staging` updates
   * the row it already has instead of adding a second one with the same name.
   *
   * ## `previousId` is what makes EDIT work, and it is not optional in practice
   *
   * The id is derived from the scope and the slug, so editing the text (`deploy
   * staging` → `deploy prod`) or moving the scope produces a DIFFERENT id — and
   * a save that only wrote the new row would leave the old one behind, which is
   * exactly the "renaming left both copies" bug `writeSkillFile` takes a
   * `previousDir` for. The caller passes the id it edited, and the old row is
   * removed when the id actually moved.
   *
   * `createdAt` is preserved across a replace so the list does not reorder under
   * an edit.
   */
  async save(
    input: {
      command: string;
      scope: CustomScope;
      root: string | null;
      cwd: string;
    },
    previousId?: string | null,
  ): Promise<CustomCommand> {
    const slug = commandSlug(input.command);
    if (!slug) throw new Error('A command needs at least one letter or digit.');

    const id = commandRecordId(input.scope, input.root, slug);
    const existing = await this.api.storage.records.get<CustomCommand>(COLLECTION, id);
    const entry: CustomCommand = {
      id,
      command: input.command.trim(),
      scope: input.scope,
      // A global command stores no root: the field means "which repository", and
      // a stale path there would read as one.
      root: input.scope === 'global' ? null : input.root,
      cwd: input.cwd || '.',
      createdAt: existing?.createdAt ?? Date.now(),
    };
    await this.api.storage.records.put(COLLECTION, id, entry as unknown as PluginJson);

    // The edited row moved: drop the one it was. Read BEFORE the write so the
    // moved-from entry's `createdAt` is the one the new row carries, and removed
    // after so a failure to remove cannot lose the command outright.
    if (previousId && previousId !== id) {
      await this.api.storage.records.remove(COLLECTION, previousId);
    }
    return entry;
  }

  /** Remove one command by its record id. Answers false when there was none. */
  async remove(id: string): Promise<boolean> {
    const existing = await this.api.storage.records.get<CustomCommand>(COLLECTION, id);
    if (!existing) return false;
    await this.api.storage.records.remove(COLLECTION, id);
    return true;
  }
}

/** Whether a stored blob is one of ours — a row written by an older build may not be. */
function isCustomCommand(value: unknown): value is CustomCommand {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Partial<CustomCommand>;
  return (
    typeof entry.id === 'string' &&
    typeof entry.command === 'string' &&
    (entry.scope === 'global' || entry.scope === 'repo') &&
    typeof entry.cwd === 'string' &&
    typeof entry.createdAt === 'number'
  );
}

/**
 * The prefix that marks a command id as one of the user's.
 *
 * A custom id has to be distinguishable from a file id (`<file>#<kind>:<name>`)
 * without a lookup, because the runner resolves a custom id against its STORAGE
 * while a file id is resolved against a fresh scan. `custom:` cannot collide
 * with a path, and the rest of the id is the record id verbatim — so the panel
 * and the server derive the same key from the same rules.
 */
export const CUSTOM_PREFIX = 'custom:';

/** The command id a stored command is run by. */
export function customCommandId(entry: CustomCommand): string {
  return `${CUSTOM_PREFIX}${entry.id}`;
}

/** The record id a command id names, or null when it is not a custom one. */
export function customRecordIdOf(commandId: string): string | null {
  if (!commandId.startsWith(CUSTOM_PREFIX)) return null;
  const id = commandId.slice(CUSTOM_PREFIX.length);
  return id.length > 0 ? id : null;
}

/**
 * The user's own commands as one listing group.
 *
 * A group rather than a flat prefix on the file groups, because every surface
 * that reads the listing is already built around groups: the collapse state, the
 * count badge, the header treatment. The `file` is the label the header prints —
 * deliberately not a path, since these commands come from no file.
 *
 * **Always present, even with nothing in it.** This group's header is where the
 * Add button lives, so a repository with no command file at all would otherwise
 * be the one place the feature could not be reached from: the panel would render
 * its "no command file found" note and offer no way to add one. The empty group
 * IS the entry point.
 */
export function customGroupFor(commands: readonly CustomCommand[]): CommandGroup {
  return {
    file: 'Custom commands',
    cwd: '.',
    kind: 'custom',
    customGroup: true,
    commands: commands.map(
      (entry): Command => ({
        id: customCommandId(entry),
        name: entry.command,
        // The stored text IS what runs, so the label is the text rather than a
        // reconstruction — a `bun run x` label would be a guess about a command
        // the user wrote as `npm run x -- --watch`.
        label: entry.command,
        // The one command source that involves a shell, because the text is what
        // the user wrote (a pipe, a `&&`, a variable).
        argv: ['sh', '-c', entry.command],
        custom: entry,
      }),
    ),
  };
}
