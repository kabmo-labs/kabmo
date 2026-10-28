/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `buildPromptText` is the last thing that touches a prompt before the RPC
 * bridge forwards it, and its two rewrites are order-sensitive:
 *
 * - `@agent` mentions must become an explicit task-tool delegation directive,
 *   but ONLY when the agent list loads. A failed settings read must not eat the
 *   user's text or mangle a mention into a delegation the user never asked for.
 * - `@file:` namespaces are stripped only AFTER the agent pass, so a file named
 *   like an agent is not swallowed as one. The reverse order would turn
 *   `@file:build/x.ts` into a delegation to agent `build`.
 *
 * The attachment rule is pinned too: a file whose bytes could not be read is
 * dropped from the prompt entirely rather than inlined as an empty fenced
 * block, which would tell the model the file exists and say nothing about it.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { buildPromptText } from '@/client/hooks/chat/timeline/prompt-text';
import { invalidateComposerCache } from '@/shared/lib/chat/composer/client';

type TextFile = Parameters<typeof buildPromptText>[1][number] & { missing?: boolean };

/** The runner's own fetch, reached through `Bun` so a stub leaked onto the global cannot be mistaken for it. */
const originalFetch = Bun.fetch;

/** Agent names the composer's own settings read answers with. */
let agents: string[] = ['architect', 'build'];
/** When set, the agent settings read fails the way a dead route does. */
let agentsUnavailable = false;

function installFetch(): void {
  globalThis.fetch = (async () => {
    if (agentsUnavailable) return new Response('nope', { status: 500 });
    return new Response(JSON.stringify({ agents: agents.map((name) => ({ name, description: '' })) }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  agents = ['architect', 'build'];
  agentsUnavailable = false;
  installFetch();
  invalidateComposerCache();
});

afterEach(() => invalidateComposerCache());

afterAll(() => {
  globalThis.fetch = originalFetch;
});

function file(name: string, content: string): TextFile {
  return { name, mimeType: 'text/plain', content, size: content.length };
}

describe('buildPromptText mentions', () => {
  test('an agent mention becomes a task-tool delegation directive', async () => {
    const result = await buildPromptText('fix @architect the bug', []);
    expect(result.startsWith('Use the task tool to delegate this request to the following')).toBe(true);
    expect(result).toContain('`architect`');
    expect(result.endsWith('fix the bug')).toBe(true);
    expect(result).not.toContain('@architect');
  });

  test('a prompt that is only a mention is left untouched (nothing to delegate)', async () => {
    expect(await buildPromptText('@architect', [])).toBe('@architect');
  });

  test('a failed agent read keeps the raw prompt', async () => {
    agentsUnavailable = true;
    expect(await buildPromptText('fix @architect the bug', [])).toBe('fix @architect the bug');
  });

  test('the agent pass runs before the file namespace is stripped', async () => {
    // `build` is a known agent AND the head of a file path. The file token must
    // survive the agent pass and only then become omp's native `@path`.
    expect(await buildPromptText('look at @file:build/x.ts', [])).toBe('look at @build/x.ts');
  });

  test('a file mention is stripped even when no agent names load', async () => {
    agentsUnavailable = true;
    expect(await buildPromptText('see @file:src/a.ts', [])).toBe('see @src/a.ts');
  });

  test('a quoted file mention with spaces keeps its quotes', async () => {
    expect(await buildPromptText('read @"file:my docs/a.md"', [])).toBe('read @"my docs/a.md"');
  });

  test('a plain prompt with no mentions passes through unchanged', async () => {
    expect(await buildPromptText('just a normal question', [])).toBe('just a normal question');
  });
});

describe('buildPromptText attachments', () => {
  test('a readable text file is appended after the prompt as a language-tagged fence', async () => {
    const result = await buildPromptText('review this', [file('a.py', 'print(1)')]);
    expect(result).toContain('Attached file: a.py');
    expect(result).toContain('```python');
    expect(result).toContain('print(1)');
    expect(result.indexOf('review this')).toBeLessThan(result.indexOf('Attached file: a.py'));
  });

  test('an unreadable file is dropped rather than inlined empty', async () => {
    const missing: TextFile = { ...file('gone.ts', ''), missing: true };
    const result = await buildPromptText('review this', [file('kept.ts', 'const a = 1;'), missing]);
    expect(result).toContain('Attached file: kept.ts');
    expect(result).not.toContain('gone.ts');
  });

  test('mentions are translated in the same call as attachment inlining', async () => {
    const result = await buildPromptText('look @file:src/a.ts', [file('b.ts', 'let b = 2;')]);
    expect(result).toContain('@src/a.ts');
    expect(result).toContain('Attached file: b.ts');
    expect(result).not.toContain('@file:');
  });
});
