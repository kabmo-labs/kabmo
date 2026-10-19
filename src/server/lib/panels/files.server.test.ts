/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Reading a plugin's files off disk.
 *
 * The rule pinned here is the one that decides whether a README is found at all:
 * a manifest may name one, and when it does not the `README.md` an author has
 * already written for the repository is used. That default is what makes the
 * pane's README button work for a plugin that never thought about it — and
 * skipping it would have shown the button for nobody.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { findReadme, readPluginManifest, subdirectories } from '@/server/lib/panels/files.server';

let root = '';

beforeEach(() => {
  root = fs.mkdtempSync(join(tmpdir(), 'omc-panel-files-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('findReadme', () => {
  test('uses the declared file when the manifest names one', async () => {
    fs.writeFileSync(join(root, 'GUIDE.md'), '# Guide');
    expect(await findReadme(root, 'GUIDE.md')).toBe('GUIDE.md');
  });

  test('falls back to the README.md an author already wrote', async () => {
    // The default that makes the README button work without any manifest change.
    fs.writeFileSync(join(root, 'README.md'), '# Demo');
    expect(await findReadme(root)).toBe('README.md');
  });

  test('finds a lowercase readme on a case-sensitive filesystem', async () => {
    // The second candidate exists for Linux (and CI), where `readme.md` is a
    // different file. On macOS's case-insensitive filesystem this cannot be
    // distinguished from `README.md`, so the assertion is that SOME readme is
    // found rather than which spelling won.
    fs.writeFileSync(join(root, 'readme.md'), '# Demo');
    const found = await findReadme(root);
    expect(found?.toLowerCase()).toBe('readme.md');
  });

  test('answers undefined when there is nothing to read', async () => {
    expect(await findReadme(root)).toBeUndefined();
  });

  test('a declared file that does not exist is not replaced by the convention', async () => {
    // The manifest is the author's explicit choice: silently reading a different
    // file would show the user something the plugin did not point at.
    fs.writeFileSync(join(root, 'README.md'), '# Demo');
    expect(await findReadme(root, 'GUIDE.md')).toBeUndefined();
  });
});

describe('subdirectories', () => {
  test('lists directories only, sorted, ignoring files', async () => {
    fs.mkdirSync(join(root, 'b-plugin'));
    fs.mkdirSync(join(root, 'a-plugin'));
    fs.writeFileSync(join(root, 'README.md'), 'not a plugin');

    expect(await subdirectories(root)).toEqual(['a-plugin', 'b-plugin']);
  });

  test('answers an empty list for a directory that does not exist', async () => {
    // The scan runs before a marketplace exists, and a missing root must not
    // throw — it is simply an empty store.
    expect(await subdirectories(join(root, 'nope'))).toEqual([]);
  });
});

describe('readPluginManifest', () => {
  test('reads a standalone kabmo.json', async () => {
    fs.writeFileSync(join(root, 'kabmo.json'), JSON.stringify({ id: 'demo' }));
    expect(await readPluginManifest(root)).toEqual({ kind: 'manifest', value: { id: 'demo' } });
  });

  test('reads the kabmo key out of package.json', async () => {
    fs.writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'x', kabmo: { id: 'demo' } }));
    expect(await readPluginManifest(root)).toEqual({ kind: 'manifest', value: { id: 'demo' } });
  });

  test('reads a pre-rename ompchamber.json, so an old install keeps loading', async () => {
    fs.writeFileSync(join(root, 'ompchamber.json'), JSON.stringify({ id: 'legacy' }));
    expect(await readPluginManifest(root)).toEqual({ kind: 'manifest', value: { id: 'legacy' } });
  });

  test('reads a pre-rename package.json key, and the new key wins when both exist', async () => {
    fs.writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'x', ompchamber: { id: 'legacy' } }));
    expect(await readPluginManifest(root)).toEqual({ kind: 'manifest', value: { id: 'legacy' } });

    fs.writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'x', kabmo: { id: 'current' }, ompchamber: { id: 'legacy' } }),
    );
    expect(await readPluginManifest(root)).toEqual({ kind: 'manifest', value: { id: 'current' } });
  });

  test('a directory with no manifest is not a plugin, and is skipped in silence', async () => {
    // The marketplace root is a directory a user may drop a README into, so a
    // stray folder must not be reported as a broken plugin.
    fs.writeFileSync(join(root, 'README.md'), 'scratch');
    expect(await readPluginManifest(root)).toEqual({ kind: 'none' });
  });

  test('a package.json without the key is not a plugin either', async () => {
    fs.writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'x' }));
    expect(await readPluginManifest(root)).toEqual({ kind: 'none' });
  });

  test('a manifest that EXISTS but cannot be parsed is reported', async () => {
    // The distinction the whole three-answer shape exists for: this folder was
    // meant to be a plugin, and collapsing it with "no manifest" made every
    // corrupt install look like a folder that was never a plugin.
    fs.writeFileSync(join(root, 'kabmo.json'), '{ not json');
    expect(await readPluginManifest(root)).toEqual({ kind: 'error', reason: 'kabmo.json is not valid JSON' });

    fs.rmSync(join(root, 'kabmo.json'));
    fs.writeFileSync(join(root, 'package.json'), '{ not json');
    expect(await readPluginManifest(root)).toEqual({ kind: 'error', reason: 'package.json is not valid JSON' });
  });
});
