/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Picking a provider's icon URL from its own page.
 *
 * Every case here is a way the row shows the wrong picture: the root ICO
 * instead of the declared 192px logo, Safari's monochrome `mask-icon` painted as
 * a blob, or `https://host/v1/favicon.ico` — a 404 on nearly every gateway.
 */

import { describe, expect, test } from 'bun:test';
import {
  looksLikeSvg,
  pickIconHrefs,
  providerOrigin,
  readLinkTags,
} from '@/server/lib/models/provider-icon-parse';

const ORIGIN = 'https://kenari.id';

describe('providerOrigin', () => {
  test('drops the path, because baseUrl usually ends in /v1', () => {
    expect(providerOrigin('https://kenari.id/v1')).toBe(ORIGIN);
    expect(providerOrigin('https://kenari.id/v1/')).toBe(ORIGIN);
    expect(providerOrigin('http://localhost:11434/v1')).toBe('http://localhost:11434');
  });

  test('a bare host gets https', () => {
    expect(providerOrigin('kenari.id')).toBe(ORIGIN);
    expect(providerOrigin('kenari.id/v1')).toBe(ORIGIN);
  });

  test('anything without a site has no origin', () => {
    expect(providerOrigin(undefined)).toBeNull();
    expect(providerOrigin('')).toBeNull();
    expect(providerOrigin('   ')).toBeNull();
    expect(providerOrigin('/tmp/models')).toBeNull();
    expect(providerOrigin('ftp://kenari.id')).toBeNull();
  });
});

describe('readLinkTags', () => {
  test('reads attributes in either quote style, case-insensitively', () => {
    const tags = readLinkTags(`<link REL='icon' Href="/a.png"><link rel="icon" href=/b.png>`);
    expect(tags).toEqual([
      { rel: 'icon', href: '/a.png' },
      { rel: 'icon', href: '/b.png' },
    ]);
  });

  test('ignores a link with no rel or no href', () => {
    expect(readLinkTags('<link href="/a.png"><link rel="icon">')).toEqual([]);
  });
});

describe('pickIconHrefs', () => {
  test('an apple-touch-icon wins over a 16px icon', () => {
    const html = `
      <link rel="icon" href="/favicon-16.png" sizes="16x16">
      <link rel="apple-touch-icon" href="/apple-touch-icon.png">
    `;
    expect(pickIconHrefs(html, ORIGIN)).toEqual([
      'https://kenari.id/apple-touch-icon.png',
      'https://kenari.id/favicon-16.png',
    ]);
  });

  test('a larger declared size beats a smaller one', () => {
    const html = `
      <link rel="icon" href="/small.png" sizes="32x32">
      <link rel="icon" href="/large.png" sizes="192x192">
    `;
    expect(pickIconHrefs(html, ORIGIN)[0]).toBe('https://kenari.id/large.png');
  });

  test('an SVG (`sizes="any"`) outranks a fixed size', () => {
    const html = `
      <link rel="icon" href="/icon.png" sizes="192x192">
      <link rel="icon" href="/icon.svg" type="image/svg+xml" sizes="any">
    `;
    expect(pickIconHrefs(html, ORIGIN)[0]).toBe('https://kenari.id/icon.svg');
  });

  test('mask-icon is skipped — it is a monochrome silhouette', () => {
    const html = `
      <link rel="mask-icon" href="/pinned.svg" color="#000">
      <link rel="icon" href="/icon.png">
    `;
    expect(pickIconHrefs(html, ORIGIN)).toEqual(['https://kenari.id/icon.png']);
  });

  test('relative, root-relative and absolute hrefs all resolve', () => {
    const html = `
      <link rel="icon" href="favicon.png">
      <link rel="icon" href="/assets/icon.png">
      <link rel="icon" href="https://cdn.example.com/icon.png">
    `;
    expect(pickIconHrefs(html, ORIGIN)).toEqual([
      'https://kenari.id/favicon.png',
      'https://kenari.id/assets/icon.png',
      'https://cdn.example.com/icon.png',
    ]);
  });

  test('a non-http href is not a candidate', () => {
    const html = '<link rel="icon" href="data:image/png;base64,AAAA">';
    expect(pickIconHrefs(html, ORIGIN)).toEqual([]);
  });

  test('duplicates collapse and the list is capped', () => {
    const html = Array.from({ length: 8 }, (_, index) => (
      `<link rel="icon" href="/i${index}.png" sizes="${index + 1}x${index + 1}">`
    )).join('') + '<link rel="icon" href="/i7.png">';
    const urls = pickIconHrefs(html, ORIGIN, 4);
    expect(urls).toHaveLength(4);
    expect(new Set(urls).size).toBe(4);
    // Highest score first: 8x8, then 7x7, then 6x6, then 5x5.
    expect(urls[0]).toBe('https://kenari.id/i7.png');
  });
});

describe('looksLikeSvg', () => {
  test('recognises a document and one behind a prolog', () => {
    expect(looksLikeSvg(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe(true);
    expect(looksLikeSvg(new TextEncoder().encode('<?xml version="1.0"?>\n<svg/>'))).toBe(true);
  });

  test('a PNG is not an SVG', () => {
    expect(looksLikeSvg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
  });
});
