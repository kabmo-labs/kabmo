/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The pure/parseable half of `src/shared/lib/browser`: address normalization,
 * the untrusted-JSON readers, the eval-script activity parser, the observer
 * payload validator, and the panel→composer page-context bridge.
 *
 * Why each case is risky:
 *
 * - `normalizeUrl` is the only gate between a typed/pasted address and the
 *   shared Chromium. If it ever forwards `javascript:`, `file:` or `data:`, a
 *   pasted link executes in the project browser; the scheme allow-list is
 *   pinned explicitly, including the `about:blank` rejection.
 * - `extractEvalActions` parses source order out of agent-written code. Toast
 *   ordering and the consecutive-duplicate collapse are what a user sees, and
 *   the 8-action cap keeps a long script from flooding the panel.
 * - `parseObserverPayload` validates a payload the *page* controls. An unknown
 *   `kind` reaching the SSE stream would render an action chip with no icon.
 * - `readString`/`readNumber` guard every CDP payload; `NaN`/`Infinity` are
 *   numbers but are not valid CDP ids or session numbers.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';

import { normalizeUrl } from '@/shared/lib/browser/url';
import { readNumber, readString } from '@/shared/lib/browser/util';
import { extractEvalActions, shortUrl } from '@/shared/lib/browser/activity';
import { OBSERVER_BINDING, parseObserverPayload } from '@/shared/lib/browser/observer';
import { BROWSER_INCLUDE_PAGE_EVENT, emitBrowserPageContext } from '@/shared/lib/browser/page-context';

describe('normalizeUrl', () => {
  test('gives a bare host the https scheme and keeps query + fragment', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com/');
    expect(normalizeUrl('  example.com  ')).toBe('https://example.com/');
    expect(normalizeUrl('https://example.com/a?b=1#c')).toBe('https://example.com/a?b=1#c');
    expect(normalizeUrl('127.0.0.1:8080')).toBe('https://127.0.0.1:8080/');
  });

  test('passes an empty input through instead of inventing a host', () => {
    expect(normalizeUrl('')).toBe('');
    expect(normalizeUrl('   ')).toBe('');
  });

  test('rejects every non-http(s) scheme', () => {
    for (const input of [
      'javascript:alert(1)',
      'file:///etc/passwd',
      'data:text/html,<script>1</script>',
      'about:blank',
      'mailto:a@b.test',
      'ftp://example.com',
    ]) {
      expect(() => normalizeUrl(input)).toThrow('Only http and https URLs are allowed');
    }
  });

  test('treats `host:port` as a scheme, not a host, so it is rejected', () => {
    // The regex sees `localhost:` as a scheme; a user typing a dev address
    // must type `http://localhost:3000`. Pinned because the failure is a bare
    // Error toast, not a silent navigation.
    expect(() => normalizeUrl('localhost:3000')).toThrow('Only http and https URLs are allowed');
  });

  test('surfaces a malformed URL rather than returning something unusable', () => {
    expect(() => normalizeUrl('http://')).toThrow();
  });
});

describe('readString / readNumber', () => {
  test('reads only the exact primitive type', () => {
    const source: Record<string, unknown> = { s: 'x', n: 4, zero: 0, nan: Number.NaN, inf: Infinity, bool: true, obj: {} };
    expect(readString(source, 's')).toBe('x');
    expect(readString(source, 'n')).toBeUndefined();
    expect(readString(source, 'missing')).toBeUndefined();
    expect(readNumber(source, 'n')).toBe(4);
    expect(readNumber(source, 'zero')).toBe(0);
    expect(readNumber(source, 's')).toBeUndefined();
  });

  test('rejects non-finite numbers so they cannot become CDP ids', () => {
    const source: Record<string, unknown> = { nan: Number.NaN, inf: Infinity, neg: -Infinity };
    expect(readNumber(source, 'nan')).toBeUndefined();
    expect(readNumber(source, 'inf')).toBeUndefined();
    expect(readNumber(source, 'neg')).toBeUndefined();
  });
});

describe('shortUrl', () => {
  test('drops the scheme and keeps host + path, trimming a bare root', () => {
    expect(shortUrl('https://example.com/a/b?q=1')).toBe('example.com/a/b');
    expect(shortUrl('https://example.com/')).toBe('example.com');
    expect(shortUrl('http://x.test:8080/p')).toBe('x.test/p');
  });

  test('truncates unparseable input and blanks an empty string', () => {
    expect(shortUrl('not a url')).toBe('not a url');
    expect(shortUrl('   ')).toBe('');
    expect(shortUrl('x'.repeat(200)).length).toBe(64);
  });
});

describe('extractEvalActions', () => {
  test('reports actions in source order with the parsed URL', () => {
    const code = 'browser.open({ url: "https://a.test/p" }); await wait(1500); await page.screenshot();';
    expect(extractEvalActions({ code })).toEqual([
      { kind: 'open', label: 'Membuka halaman a.test/p' },
      { kind: 'wait', label: 'Menunggu 2 detik' },
      { kind: 'screenshot', label: 'Mengambil screenshot' },
    ]);
  });

  test('orders by position even when a later pattern appears first in the source', () => {
    const code = 'await tab.goto("https://z.test"); browser.open({url:"https://a.test"});';
    expect(extractEvalActions({ code }).map((action) => action.kind)).toEqual(['navigate', 'open']);
  });

  test('collapses only consecutive duplicates', () => {
    expect(extractEvalActions({ code: 'await page.screenshot(); await page.screenshot();' })).toEqual([
      { kind: 'screenshot', label: 'Mengambil screenshot' },
    ]);
  });

  test('caps the list at eight actions', () => {
    const code =
      'browser.open({url:"https://a.test"}); await wait(1000); await wait(2000); await page.screenshot();' +
      ' await page.upload("f"); await page.scroll(); tab.close(); browser.open("https://b.test");' +
      ' await tab.goto("https://c.test");';
    expect(extractEvalActions({ code }).length).toBe(8);
  });

  test('ignores waits under one second and non-numeric input', () => {
    expect(extractEvalActions({ code: 'wait(999)' })).toEqual([]);
    expect(extractEvalActions({ code: 'wait(1_000)' })).toEqual([{ kind: 'wait', label: 'Menunggu 1 detik' }]);
    expect(extractEvalActions({ code: 42 })).toEqual([]);
    expect(extractEvalActions({})).toEqual([]);
  });

  test('reports minutes for a long wait and skips an open with no URL', () => {
    expect(extractEvalActions({ code: 'wait(60000)' })).toEqual([{ kind: 'wait', label: 'Menunggu 1 menit' }]);
    expect(extractEvalActions({ code: 'browser.open({});' })).toEqual([]);
  });

  test('recognises the browser.close / tab.close spellings', () => {
    expect(extractEvalActions({ code: 'await browser.close();' })).toEqual([{ kind: 'close', label: 'Menutup tab' }]);
    expect(extractEvalActions({ code: 'await page.uploadFile("x");' })).toEqual([{ kind: 'upload', label: 'Mengunggah file' }]);
    expect(extractEvalActions({ code: 'await el.scrollIntoView();' })).toEqual([{ kind: 'scroll', label: 'Menggulir halaman' }]);
  });
});

describe('parseObserverPayload', () => {
  test('accepts only the four DOM interaction kinds', () => {
    for (const kind of ['click', 'type', 'press', 'submit']) {
      expect<unknown>(parseObserverPayload(JSON.stringify({ kind, label: 'x' }))).toEqual({ kind, label: 'x' });
    }
    // `error`/`loaded`/`open` are produced server-side, never by the page.
    for (const kind of ['error', 'loaded', 'open', 'navigate']) {
      expect(parseObserverPayload(JSON.stringify({ kind, label: 'x' }))).toBeNull();
    }
  });

  test('rejects malformed, non-object, and label-less payloads', () => {
    expect(parseObserverPayload('not json')).toBeNull();
    expect(parseObserverPayload(42)).toBeNull();
    expect(parseObserverPayload(null)).toBeNull();
    expect(parseObserverPayload(JSON.stringify(['click']))).toBeNull();
    expect(parseObserverPayload(JSON.stringify({ kind: 'click' }))).toBeNull();
    expect(parseObserverPayload(JSON.stringify({ kind: 'click', label: '' }))).toBeNull();
  });

  test('truncates a label the page inflated past 120 characters', () => {
    const parsed = parseObserverPayload(JSON.stringify({ kind: 'submit', label: 'x'.repeat(200) }));
    expect(parsed?.label.length).toBe(120);
  });

  test('names the binding the injected script calls', () => {
    expect(OBSERVER_BINDING).toBe('__kabmoAction');
  });
});

describe('browser page-context bridge', () => {
  const DOM_GLOBALS = ['window', 'document', 'CustomEvent'] as const;
  let win: Window;
  /** The runner's own globals, put back on teardown — `CustomEvent` is native. */
  const native: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

  beforeAll(() => {
    win = new Window({ url: 'http://localhost' });
    const target = globalThis as unknown as Record<string, unknown>;
    for (const key of DOM_GLOBALS) {
      if (!(key in native)) native[key] = target[key];
      target[key] = (win as unknown as Record<string, unknown>)[key];
    }
  });

  afterAll(() => {
    const target = globalThis as unknown as Record<string, unknown>;
    for (const key of DOM_GLOBALS) {
      if (native[key] === undefined) delete target[key];
      else target[key] = native[key];
    }
  });

  test('dispatches the page detail under the event name the composer listens for', () => {
    expect(BROWSER_INCLUDE_PAGE_EVENT).toBe('omp:browser-include-page');
    const seen: unknown[] = [];
    const listener = ((event: Event): void => {
      seen.push((event as CustomEvent).detail);
    }) as unknown as Parameters<typeof window.addEventListener>[1];
    window.addEventListener(BROWSER_INCLUDE_PAGE_EVENT, listener);
    emitBrowserPageContext({ url: 'https://a.test', title: 'A' });
    window.removeEventListener(BROWSER_INCLUDE_PAGE_EVENT, listener);
    expect(seen).toEqual([{ url: 'https://a.test', title: 'A' }]);
  });
});
