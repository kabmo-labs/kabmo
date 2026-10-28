/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';
import { renderMarkdown } from '@/shared/lib/markdown/marked';

describe('autolink vs code span', () => {
  test('a backticked email stays a code span, not a mailto link', () => {
    const html = renderMarkdown('addresses (`NNN+login@users.noreply.github.com`) and more');
    expect(html).toContain('<code class="inline-code">NNN+login@users.noreply.github.com</code>');
    expect(html).not.toContain('mailto:');
    expect(html).not.toContain('`');
  });

  test('a backticked URL stays a code span', () => {
    const html = renderMarkdown('see `https://bun.sh/docs` for more');
    expect(html).toContain('<code class="inline-code">https://bun.sh/docs</code>');
  });

  test('ordinary autolinks are untouched', () => {
    expect(renderMarkdown('see https://bun.sh/docs for more')).toContain('<a href="https://bun.sh/docs">');
    expect(renderMarkdown('write to a@b.com now')).toContain('<a href="mailto:a@b.com">');
  });

  test('a URL next to a code span keeps both', () => {
    const html = renderMarkdown('https://bun.sh then `npm i`');
    expect(html).toContain('<a href="https://bun.sh">');
    expect(html).toContain('<code class="inline-code">npm i</code>');
  });
});
