/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Inline code that names a file, and the marker the chat timeline reads.
 *
 * Detection is the load-bearing half: a false positive opens a tab that cannot
 * read, so every rejected shape here is a bug this file prevents. The marker
 * half pins that it rewrites ONLY the chip `marked.ts` emits — a fenced block
 * that prints that markup is escaped and must survive untouched.
 */

import { describe, expect, test } from 'bun:test';
import { inlineFileReference, markInlineFilePaths } from '@/shared/lib/markdown/inline-file';

describe('inlineFileReference', () => {
  test('a workspace path with a directory is a file', () => {
    expect(inlineFileReference('src/client/App.tsx')).toEqual({ path: 'src/client/App.tsx' });
    expect(inlineFileReference('docs/hero.png')).toEqual({ path: 'docs/hero.png' });
  });

  test('a bare filename and a dot-file are files', () => {
    expect(inlineFileReference('AGENTS.md')).toEqual({ path: 'AGENTS.md' });
    expect(inlineFileReference('.gitignore')).toEqual({ path: '.gitignore' });
    expect(inlineFileReference('.env')).toEqual({ path: '.env' });
    expect(inlineFileReference('Makefile')).toEqual({ path: 'Makefile' });
    expect(inlineFileReference('bun.lock')).toEqual({ path: 'bun.lock' });
  });

  test('`./` is stripped, because the tab resolves from the workspace root', () => {
    expect(inlineFileReference('./src/a.ts')).toEqual({ path: 'src/a.ts' });
  });

  test('the line suffixes the editor can reveal are carried', () => {
    expect(inlineFileReference('src/a.ts:42')).toEqual({ path: 'src/a.ts', line: 42 });
    expect(inlineFileReference('src/a.ts:42-50')).toEqual({ path: 'src/a.ts', line: 42 });
    expect(inlineFileReference('src/a.ts:42:7')).toEqual({ path: 'src/a.ts', line: 42 });
    expect(inlineFileReference('src/a.ts#L42-L50')).toEqual({ path: 'src/a.ts', line: 42 });
  });

  test('ordinary inline code is not a file', () => {
    const rejected = [
      'bun test',
      'state.user.id',
      'https://bun.sh/docs',
      '/Users/me/project/a.ts',
      '~/project/a.ts',
      'C:\\project\\a.ts',
      'src/',
      '*.tsx',
      'src/a.ts,',
      '../a.ts',
      'src/unknown.xyz',
      'src/foo',
      'App',
      '--config.ts',
      'src//a.ts',
      'src/a.ts#section',
      'npm:foo',
      'a?b.ts',
    ];
    for (const text of rejected) expect(inlineFileReference(text)).toBeNull();
  });
});

describe('markInlineFilePaths', () => {
  test('a file chip becomes a focusable button with its line', () => {
    const html = markInlineFilePaths('<p>see <code class="inline-code">src/a.ts:12</code></p>');
    expect(html).toContain('data-file-path="src/a.ts"');
    expect(html).toContain('data-file-line="12"');
    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-label="Open src/a.ts in the editor"');
  });

  test('ordinary inline code is byte-identical', () => {
    const html = '<p><code class="inline-code">bun test</code></p>';
    expect(markInlineFilePaths(html)).toBe(html);
  });

  test('a fenced block that prints the chip markup is not a chip', () => {
    // What `marked` emits for a fence whose text is that markup: the tags are
    // escaped, so the marker cannot see a chip and must not invent one.
    const html = '<pre><code class="language-text">&lt;code class=&quot;inline-code&quot;&gt;src/a.ts&lt;/code&gt;</code></pre>';
    expect(markInlineFilePaths(html)).toBe(html);
  });

  test('an entity in a filename is decoded for detection and re-escaped for the attribute', () => {
    const html = markInlineFilePaths('<p><code class="inline-code">a&amp;b.ts</code></p>');
    expect(html).toContain('data-file-path="a&amp;b.ts"');
    expect(html).toContain('>a&amp;b.ts</code>');
  });

  test('marking twice is the same as marking once', () => {
    const once = markInlineFilePaths('<code class="inline-code">src/a.ts</code>');
    expect(markInlineFilePaths(once)).toBe(once);
  });
});
