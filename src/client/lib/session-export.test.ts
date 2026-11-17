/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { exportSessionMarkdown } from '@/client/lib/session-export';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let nativeFetch: typeof fetch;
let nativeClick: () => void;
let downloads: Array<{ href: string; name: string }>;

beforeEach(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
  nativeFetch = globalThis.fetch;
  const Anchor = window.HTMLAnchorElement;
  nativeClick = Anchor.prototype.click;
  downloads = [];
  Anchor.prototype.click = function click(this: HTMLAnchorElement) {
    downloads.push({ href: this.getAttribute('href') ?? '', name: this.download });
  };
});

afterEach(() => {
  globalThis.fetch = nativeFetch;
  window.HTMLAnchorElement.prototype.click = nativeClick;
});

afterAll(() => restoreDomGlobals());

describe('exportSessionMarkdown', () => {
  test('validates the server file, then downloads that URL', async () => {
    let requested = '';
    globalThis.fetch = (async (input: string | URL | Request) => {
      requested = String(input);
      return new Response('# Fix the parser\n\n## User\n\nWhy does it fail?\n', {
        headers: {
          'content-type': 'text/markdown; charset=utf-8',
          'content-disposition': 'attachment; filename="Fix-the-parser.md"',
        },
      });
    }) as unknown as typeof fetch;

    const result = await exportSessionMarkdown('s1');

    expect(requested).toBe('/api/sessions/s1/export');
    expect(result).toEqual({ ok: true, name: 'Fix-the-parser.md' });
    expect(downloads).toEqual([{ href: '/api/sessions/s1/export', name: 'Fix-the-parser.md' }]);
  });

  test('refuses an empty transcript instead of downloading an empty file', async () => {
    globalThis.fetch = (async () =>
      new Response('', { headers: { 'content-type': 'text/markdown' } })) as unknown as typeof fetch;

    const result = await exportSessionMarkdown('s1');

    expect(result).toEqual({ ok: false, error: 'This session has no transcript to export.' });
    expect(downloads).toEqual([]);
  });

  test('reports the server refusal', async () => {
    globalThis.fetch = (async () =>
      Response.json({ error: 'Session not found' }, { status: 404 })) as unknown as typeof fetch;

    const result = await exportSessionMarkdown('s1');

    expect(result).toEqual({ ok: false, error: 'Session not found' });
    expect(downloads).toEqual([]);
  });
});
