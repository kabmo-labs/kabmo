/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';
import { resolveDocumentReference, rewriteDocumentReferences } from '@/shared/lib/markdown/document-urls';

const doc = (path: string, root?: string, repo?: string) => ({ path, root, repo });

describe('resolveDocumentReference', () => {
  test('resolves beside the document, not beside the app', () => {
    expect(resolveDocumentReference('docs/hero.png', doc('README.md'))?.path).toBe('docs/hero.png');
    expect(resolveDocumentReference('img/a.png', doc('docs/guide.md'))?.path).toBe('docs/img/a.png');
  });

  test('walks out of the document folder', () => {
    expect(resolveDocumentReference('../README.md', doc('docs/guide.md'))?.path).toBe('README.md');
    expect(resolveDocumentReference('./a.png', doc('docs/guide.md'))?.path).toBe('docs/a.png');
  });

  test('a leading slash is the scope root, not the document folder', () => {
    expect(resolveDocumentReference('/docs/a.png', doc('manual/v2/guide.md'))?.path).toBe('docs/a.png');
  });

  test('cannot climb above the scope root', () => {
    expect(resolveDocumentReference('../../../../etc/passwd', doc('README.md'))?.path).toBe('etc/passwd');
  });

  test('keeps the scope in the raw URL', () => {
    const resolved = resolveDocumentReference('a.png', doc('docs/guide.md', '/ws', 'projects/x'));
    expect(resolved?.url).toBe('/api/fs/raw?path=docs%2Fa.png&root=%2Fws&repo=projects%2Fx');
    // `repo: '.'` means the root itself, so the param is omitted.
    expect(resolveDocumentReference('a.png', doc('docs/guide.md', '/ws', '.'))?.url)
      .toBe('/api/fs/raw?path=docs%2Fa.png&root=%2Fws');
  });

  test('a query or fragment belongs to the reference, not the path', () => {
    expect(resolveDocumentReference('img/a.png?v=2#frag', doc('docs/guide.md'))?.path).toBe('docs/img/a.png');
  });

  test('decodes percent escapes', () => {
    expect(resolveDocumentReference('my%20image.png', doc('README.md'))?.path).toBe('my image.png');
  });

  test('leaves anything that is not a relative file reference alone', () => {
    for (const reference of ['https://x.test/a.png', 'mailto:a@b.c', 'data:image/png;base64,AA', '//cdn.test/a.png', '#section', '   ', '']) {
      expect(resolveDocumentReference(reference, doc('README.md'))).toBeNull();
    }
  });
});

describe('rewriteDocumentReferences', () => {
  test('points images at the raw route and links at the file they name', () => {
    expect(rewriteDocumentReferences('<img src="docs/a.png"><a href="AGENTS.md">x</a>', doc('README.md')))
      .toBe('<img src="/api/fs/raw?path=docs%2Fa.png"><a href="/api/fs/raw?path=AGENTS.md" data-file-path="AGENTS.md">x</a>');
  });

  test('escapes the query separator so the attribute survives HTML parsing', () => {
    expect(rewriteDocumentReferences('<img src="a.png">', doc('docs/g.md', '/ws')))
      .toBe('<img src="/api/fs/raw?path=docs%2Fa.png&amp;root=%2Fws">');
  });

  test('leaves external references and escaped code untouched', () => {
    const html = '<a href="https://x.test">x</a><code class="language-html">&lt;img src=&quot;a.png&quot;&gt;</code>';
    expect(rewriteDocumentReferences(html, doc('README.md'))).toBe(html);
  });
});
