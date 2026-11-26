/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `@path` mentions as ACP `resource_link` blocks.
 *
 * Only omp expands a mention into file contents. For every other agent the
 * mention is a path with no bytes behind it, so the client sends the link the
 * agent can resolve through the `fs/*` surface it was promised. The refusals
 * matter as much: an escaped or missing path must not become a link the agent
 * then fails to read.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promptFileLinks } from './prompt-files';
import { promptBlocks } from './prompt';

const scratch: string[] = [];

async function workspace(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'kabmo-acp-links-'));
  scratch.push(cwd);
  return cwd;
}

afterEach(async () => {
  await Promise.all(scratch.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('promptFileLinks', () => {
  test('a bare mention of an existing file becomes a link', async () => {
    const cwd = await workspace();
    await Bun.write(join(cwd, 'app.ts'), 'x');
    expect(await promptFileLinks(cwd, 'look at @app.ts please')).toEqual([
      { uri: `file://${join(cwd, 'app.ts')}`, name: 'app.ts' },
    ]);
  });

  test('a quoted mention with spaces works, and duplicates collapse', async () => {
    const cwd = await workspace();
    await Bun.write(join(cwd, 'my file.md'), 'x');
    expect(await promptFileLinks(cwd, '@"my file.md" and @"my file.md"')).toEqual([
      { uri: `file://${join(cwd, 'my file.md')}`, name: 'my file.md' },
    ]);
  });

  test('an escaped path is never a link', async () => {
    const cwd = await workspace();
    expect(await promptFileLinks(cwd, '@../../etc/hosts')).toEqual([]);
  });

  test('a missing file and an agent mention are dropped', async () => {
    const cwd = await workspace();
    expect(await promptFileLinks(cwd, '@missing.ts and @claude')).toEqual([]);
  });

  test('a file link precedes the text block', async () => {
    const blocks = promptBlocks('read it', undefined, [{ uri: 'file:///x/a.ts', name: 'a.ts' }]);
    expect(blocks).toEqual([
      { type: 'resource_link', uri: 'file:///x/a.ts', name: 'a.ts' },
      { type: 'text', text: 'read it' },
    ]);
  });
});
