/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The user's own commands: the record keying, the store's rules, and the listing
 * group.
 *
 * ## What is pinned here, and why each one is a bug shape
 *
 * - **The id is DERIVED, not generated.** A random id would mean saving the same
 *   command twice makes two rows, and a reload finds neither. The derivation is
 *   also what lets the panel address a row it drew without a second lookup.
 * - **Editing the text moves the row, and the old one goes.** `deploy staging`
 *   → `deploy prod` produces a different id, so a save that only wrote the new
 *   row would leave both — the "renaming left both copies" bug.
 * - **Scope decides visibility.** A `repo` command is invisible under another
 *   workspace; a `global` one is visible everywhere. Getting this wrong is either
 *   a command that leaks into unrelated repositories or one that disappears from
 *   its own.
 * - **The custom group is ALWAYS present, even empty.** Its header holds the Add
 *   button, so a repository with no command file is otherwise the one place the
 *   feature cannot be reached from.
 *
 * A fake `KabmoPluginApi` storage is used rather than the real database: the
 * storage contract is the host's (`plugin_records`), and what this module owns is
 * the keying and the rules around it. The MERGE and the START path are pinned in
 * `resolve.test.ts`, which needs a real filesystem.
 */

import { describe, expect, test } from 'bun:test';

import type { KabmoPluginApi, PluginJson } from '@kabmo-labs/kabmo-sdk';

import {
  CustomCommandStore,
  commandRecordId,
  commandSlug,
  customCommandId,
  customGroupFor,
  customRecordIdOf,
  rootKey,
  visibleIn,
} from './custom';
import type { CustomCommand } from '../protocol';

/** A storage fake over a Map — the host's contract, without a database. */
function fakeApi() {
  const rows = new Map<string, PluginJson>();
  const key = (collection: string, id: string) => `${collection}\0${id}`;
  const api = {
    storage: {
      records: {
        async put(collection: string, id: string, data: PluginJson) {
          rows.set(key(collection, id), data);
        },
        async get(collection: string, id: string) {
          return rows.get(key(collection, id));
        },
        async list(collection: string) {
          return [...rows.entries()]
            .filter(([k]) => k.startsWith(`${collection}\0`))
            .map(([k, data]) => ({ id: k.split('\0')[1]!, data }));
        },
        async remove(collection: string, id: string) {
          rows.delete(key(collection, id));
        },
        async clear(collection: string) {
          for (const k of [...rows.keys()]) if (k.startsWith(`${collection}\0`)) rows.delete(k);
        },
      },
    },
  } as unknown as KabmoPluginApi;
  return { api, rows };
}

describe('the record id', () => {
  test('is derived from the scope and the slug, so the same command is one row', () => {
    expect(commandRecordId('global', null, 'deploy')).toBe(commandRecordId('global', null, 'deploy'));
    // A global command carries no root: the key must not move when one is passed.
    expect(commandRecordId('global', '/ws', 'deploy')).toBe(commandRecordId('global', null, 'deploy'));
    // Two roots are two rows.
    expect(commandRecordId('repo', '/a', 'deploy')).not.toBe(commandRecordId('repo', '/b', 'deploy'));
    // Two scopes are two rows, even at the same root.
    expect(commandRecordId('global', '/a', 'deploy')).not.toBe(commandRecordId('repo', '/a', 'deploy'));
  });

  test('the root key is deterministic and short', () => {
    expect(rootKey('/Users/x/ws')).toBe(rootKey('/Users/x/ws'));
    expect(rootKey('/Users/x/ws')).not.toBe(rootKey('/Users/x/ws2'));
    expect(rootKey('/Users/x/ws')).toHaveLength(8);
  });

  test('the slug folds case and whitespace, so two spellings are one command', () => {
    expect(commandSlug('Deploy Staging')).toBe('deploy-staging');
    expect(commandSlug('deploy   staging')).toBe('deploy-staging');
    expect(commandSlug('  deploy-staging  ')).toBe('deploy-staging');
    // Punctuation only: no slug, which the store refuses rather than writing an
    // id of `g:` that two different commands would share.
    expect(commandSlug('!!!')).toBe('');
  });

  test('the command id round-trips through the prefix', () => {
    const entry = { id: 'g:deploy' } as CustomCommand;
    expect(customCommandId(entry)).toBe('custom:g:deploy');
    expect(customRecordIdOf('custom:g:deploy')).toBe('g:deploy');
    // A file command is not a custom one, and neither is an empty payload.
    expect(customRecordIdOf('package.json#package:dev')).toBeNull();
    expect(customRecordIdOf('custom:')).toBeNull();
  });
});

describe('the store', () => {
  test('saves, lists and removes', async () => {
    const { api } = fakeApi();
    const store = new CustomCommandStore(api);

    const saved = await store.save({ command: 'bun run build', scope: 'global', root: null, cwd: '.' });
    expect(saved.id).toBe('g:bun-run-build');
    expect(saved.root).toBeNull();

    const listed = await store.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]!.command).toBe('bun run build');

    expect(await store.remove(saved.id)).toBe(true);
    expect(await store.list()).toHaveLength(0);
    // A second remove answers false rather than throwing.
    expect(await store.remove(saved.id)).toBe(false);
  });

  test('re-saving the same text replaces in place and keeps createdAt', async () => {
    const { api } = fakeApi();
    const store = new CustomCommandStore(api);
    const first = await store.save({ command: 'lint', scope: 'global', root: null, cwd: '.' });
    const second = await store.save({ command: 'LINT', scope: 'global', root: null, cwd: 'packages/api' });
    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.cwd).toBe('packages/api');
    expect(await store.list()).toHaveLength(1);
  });

  test('editing the text MOVES the row and drops the old one', async () => {
    const { api } = fakeApi();
    const store = new CustomCommandStore(api);
    const first = await store.save({ command: 'deploy staging', scope: 'global', root: null, cwd: '.' });
    const moved = await store.save(
      { command: 'deploy prod', scope: 'global', root: null, cwd: '.' },
      first.id,
    );
    expect(moved.id).not.toBe(first.id);
    const listed = await store.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]!.command).toBe('deploy prod');
  });

  test('refuses a command with no letter or digit, and writes nothing', async () => {
    const { api } = fakeApi();
    const store = new CustomCommandStore(api);
    await expect(store.save({ command: '!!!', scope: 'global', root: null, cwd: '.' })).rejects.toThrow(
      /letter or digit/,
    );
    expect(await store.list()).toHaveLength(0);
  });

  test('a repo command stores its root; a global one does not', async () => {
    const { api } = fakeApi();
    const store = new CustomCommandStore(api);
    await store.save({ command: 'a', scope: 'repo', root: '/ws', cwd: '.' });
    // The root is ignored for a global command even when the caller sends one.
    await store.save({ command: 'b', scope: 'global', root: '/ws', cwd: '.' });
    const listed = await store.list();
    expect(listed.find((entry) => entry.command === 'a')!.root).toBe('/ws');
    expect(listed.find((entry) => entry.command === 'b')!.root).toBeNull();
  });

  test('a row written by an older build is skipped, not rendered as a command', async () => {
    const { api, rows } = fakeApi();
    rows.set('commands\0g:broken', { id: 'g:broken' } as unknown as PluginJson);
    const store = new CustomCommandStore(api);
    expect(await store.list()).toHaveLength(0);
  });

  test('globals sort before repo entries', async () => {
    const { api } = fakeApi();
    const store = new CustomCommandStore(api);
    await store.save({ command: 'z-repo', scope: 'repo', root: '/ws', cwd: '.' });
    await store.save({ command: 'a-global', scope: 'global', root: null, cwd: '.' });
    const listed = await store.list();
    expect(listed.map((entry) => entry.command)).toEqual(['a-global', 'z-repo']);
  });
});

describe('visibility', () => {
  const global: CustomCommand = { id: 'g:a', command: 'a', scope: 'global', root: null, cwd: '.', createdAt: 1 };
  const repo: CustomCommand = { id: 'r:a', command: 'b', scope: 'repo', root: '/ws', cwd: '.', createdAt: 2 };

  test('a global command shows everywhere, a repo one only at its own root', () => {
    expect(visibleIn([global, repo], '/ws').map((e) => e.command)).toEqual(['a', 'b']);
    expect(visibleIn([global, repo], '/other').map((e) => e.command)).toEqual(['a']);
    expect(visibleIn([global, repo], null).map((e) => e.command)).toEqual(['a']);
  });
});

describe('the listing group', () => {
  test('is always present, even with nothing in it', () => {
    // The header holds the Add button, so an empty group is the entry point.
    const group = customGroupFor([]);
    expect(group.customGroup).toBe(true);
    expect(group.kind).toBe('custom');
    expect(group.commands).toHaveLength(0);
  });

  test('a stored command keeps its text as the label, not a reconstructed argv', () => {
    const group = customGroupFor([
      { id: 'g:x', command: 'npm run x -- --watch', scope: 'global', root: null, cwd: '.', createdAt: 1 },
    ]);
    expect(group.commands[0]!.label).toBe('npm run x -- --watch');
    expect(group.commands[0]!.id).toBe('custom:g:x');
    expect(group.commands[0]!.custom?.command).toBe('npm run x -- --watch');
  });
});
