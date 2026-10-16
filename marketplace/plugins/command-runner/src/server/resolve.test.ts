/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Resolving a command id into a run: the merge into the listing, and the two
 * command sources.
 *
 * Split from `custom.test.ts` when that file crossed the 350-line ceiling, and
 * the seam is the real one: this half needs a FILESYSTEM (a real `Makefile`, a
 * real subdirectory) while that half needs only a storage fake.
 *
 * ## What is pinned here, and why each one is a bug shape
 *
 * - **The custom group is first and always present**, even in a repository with
 *   no command file at all — otherwise the Add button's own header is the one
 *   thing that cannot be reached.
 * - **A `repo` command is invisible under another workspace**, so a command
 *   cannot leak into an unrelated repository.
 * - **A custom command runs its STORED text through `sh -c`**, in its stored
 *   directory, and a client cannot name a string to run — only a row the user
 *   already saved.
 *
 * The runner is a real `RunRegistry` with a recording `publish`, so a started run
 * is observed as the registry would publish it.
 */

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ChamberPluginApi, PluginJson } from '@ompchamber/plugin-sdk';

import { CustomCommandStore, customCommandId } from './custom';
import { startRun, withCustom } from './resolve';
import { RunRegistry } from './runner';
import type { RunnerState } from '../protocol';

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
  } as unknown as ChamberPluginApi;
  return { api, rows };
}

describe('the merge', () => {
  test('puts the custom group first and always present', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cr-merge-'));
    writeFileSync(join(root, 'Makefile'), 'build:\n\techo hi\n');
    const { api } = fakeApi();
    const store = new CustomCommandStore(api);

    const empty = await withCustom({ root, repo: '.' }, store);
    expect('groups' in empty).toBe(true);
    if (!('groups' in empty)) return;
    expect(empty.groups[0]!.customGroup).toBe(true);
    expect(empty.groups.map((group) => group.file)).toContain('Makefile');

    await store.save({ command: 'my cmd', scope: 'global', root: null, cwd: '.' });
    const filled = await withCustom({ root, repo: '.' }, store);
    if (!('groups' in filled)) return;
    expect(filled.groups[0]!.commands.map((command) => command.label)).toEqual(['my cmd']);
  });

  test('a repo command is absent under another root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cr-scope-'));
    const other = mkdtempSync(join(tmpdir(), 'cr-other-'));
    const { api } = fakeApi();
    const store = new CustomCommandStore(api);
    await store.save({ command: 'only here', scope: 'repo', root, cwd: '.' });

    const here = await withCustom({ root, repo: '.' }, store);
    const there = await withCustom({ root: other, repo: '.' }, store);
    if (!('groups' in here) || !('groups' in there)) throw new Error('expected a listing');
    expect(here.groups[0]!.commands).toHaveLength(1);
    expect(there.groups[0]!.commands).toHaveLength(0);
  });
});

describe('starting a run', () => {
  /**
   * A registry whose publish/log are recorded instead of sent.
   *
   * `find` reads the run RECORD (its argv and cwd), which the registry keeps
   * `protected` — so the subclass is how a test observes what was started without
   * widening the production surface for it.
   */
  class InspectableRegistry extends RunRegistry {
    find(id: string) {
      return this.runs.get(id);
    }
  }

  function makeRegistry() {
    const published: RunnerState[] = [];
    const registry = new InspectableRegistry({
      publish: (state) => published.push(state),
      log: () => {},
      setting: async () => undefined,
    });
    return { registry, published };
  }

  test('a file command resolves through the scan, as before', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cr-start-'));
    writeFileSync(join(root, 'Makefile'), 'build:\n\techo hi\n');
    const { api } = fakeApi();
    const store = new CustomCommandStore(api);
    const { registry } = makeRegistry();

    const outcome = await startRun(registry, store, {
      root,
      repo: '.',
      sessionId: 's1',
      commandId: 'Makefile#make:build',
      background: false,
    });
    expect('runId' in outcome).toBe(true);
    const run = registry.find((outcome as { runId: string }).runId);
    expect(run?.argv).toEqual(['make', 'build']);
    expect(run?.file).toBe('Makefile');
    await registry.dispose();
  });

  test('a custom command runs its STORED text through sh -c, in its stored cwd', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cr-custom-'));
    mkdirSync(join(root, 'packages', 'api'), { recursive: true });
    const { api } = fakeApi();
    const store = new CustomCommandStore(api);
    const saved = await store.save({
      command: 'echo one && echo two',
      scope: 'repo',
      root,
      cwd: 'packages/api',
    });
    const { registry } = makeRegistry();

    const outcome = await startRun(registry, store, {
      root,
      repo: '.',
      sessionId: 's1',
      commandId: customCommandId(saved),
      background: false,
    });
    expect('runId' in outcome).toBe(true);
    const run = registry.find((outcome as { runId: string }).runId);
    expect(run?.argv).toEqual(['sh', '-c', 'echo one && echo two']);
    // The stored RELATIVE cwd is resolved against the scope's own directory.
    expect(run?.cwd).toBe(join(root, 'packages', 'api'));
    expect(run?.file).toBe('Custom commands');
    await registry.dispose();
  });

  test('an id the client invented has nothing to resolve to', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cr-unknown-'));
    const { api } = fakeApi();
    const store = new CustomCommandStore(api);
    const { registry } = makeRegistry();

    const outcome = await startRun(registry, store, {
      root,
      repo: '.',
      sessionId: 's1',
      commandId: 'custom:g:never-saved',
      background: false,
    });
    expect(outcome).toEqual({ error: 'That command is no longer saved. Refresh the list.' });
    await registry.dispose();
  });

  test('a repo command from another workspace is refused rather than run here', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cr-foreign-'));
    const other = mkdtempSync(join(tmpdir(), 'cr-foreign2-'));
    const { api } = fakeApi();
    const store = new CustomCommandStore(api);
    const saved = await store.save({ command: 'echo hi', scope: 'repo', root: other, cwd: '.' });
    const { registry } = makeRegistry();

    const outcome = await startRun(registry, store, {
      root,
      repo: '.',
      sessionId: 's1',
      commandId: customCommandId(saved),
      background: false,
    });
    expect(outcome).toEqual({ error: 'That command belongs to another workspace.' });
    await registry.dispose();
  });

});
