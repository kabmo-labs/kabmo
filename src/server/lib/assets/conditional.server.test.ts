/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';

import { notModified } from '@/server/lib/assets/conditional.server';

const ETAG = '"abc123"';
const MTIME_MS = Date.parse('2026-01-02T03:04:05.000Z');

/** A GET carrying the given conditional headers. */
const request = (headers: Record<string, string> = {}) => new Request('http://localhost/asset.js', { headers });

describe('notModified', () => {
  test('a plain request is never a match', () => {
    expect(notModified(request(), ETAG, MTIME_MS)).toBe(false);
  });

  test('a matching validator answers 304', () => {
    expect(notModified(request({ 'if-none-match': ETAG }), ETAG, MTIME_MS)).toBe(true);
  });

  test('a stale validator does not', () => {
    expect(notModified(request({ 'if-none-match': '"other"' }), ETAG, MTIME_MS)).toBe(false);
  });

  test('a weak or list-form validator still matches', () => {
    expect(notModified(request({ 'if-none-match': `W/${ETAG}` }), ETAG, MTIME_MS)).toBe(true);
    expect(notModified(request({ 'if-none-match': `"other", ${ETAG}` }), ETAG, MTIME_MS)).toBe(true);
    expect(notModified(request({ 'if-none-match': '"other", W/' + ETAG }), ETAG, MTIME_MS)).toBe(true);
  });

  test('a date at or after the mtime matches, an older one does not', () => {
    expect(notModified(request({ 'if-modified-since': new Date(MTIME_MS).toUTCString() }), ETAG, MTIME_MS)).toBe(true);
    expect(notModified(request({ 'if-modified-since': new Date(MTIME_MS + 60_000).toUTCString() }), ETAG, MTIME_MS)).toBe(true);
    expect(notModified(request({ 'if-modified-since': new Date(MTIME_MS - 1000).toUTCString() }), ETAG, MTIME_MS)).toBe(false);
  });

  // HTTP dates carry one-second resolution. A file whose mtime has a fractional
  // part must still match the `Last-Modified` this server sent for it, or no
  // request could ever revalidate.
  test('a fractional mtime is floored before comparing', () => {
    const fractional = MTIME_MS + 742;
    expect(notModified(request({ 'if-modified-since': new Date(MTIME_MS).toUTCString() }), ETAG, fractional)).toBe(true);
  });

  // RFC 9110 §13.1.3: `If-Modified-Since` MUST be ignored when `If-None-Match`
  // is present. A stale validator beside a fresh date is a stale copy.
  test('If-None-Match wins over If-Modified-Since', () => {
    const fresh = new Date(MTIME_MS + 60_000).toUTCString();
    expect(notModified(request({ 'if-none-match': '"stale"', 'if-modified-since': fresh }), ETAG, MTIME_MS)).toBe(false);
  });

  test('an unparseable date is not a match', () => {
    expect(notModified(request({ 'if-modified-since': 'not-a-date' }), ETAG, MTIME_MS)).toBe(false);
  });

  // A server that offers only `Last-Modified` revalidates on the date alone —
  // the standard fallback. Neither caller here takes this shape (the file route
  // always mints a validator, the dev proxy never has a date), but the rule is
  // the general one and the branch is reachable if either changes.
  test('without a validator, the date decides', () => {
    expect(notModified(request({ 'if-modified-since': new Date(MTIME_MS).toUTCString() }), null, MTIME_MS)).toBe(true);
    expect(notModified(request({ 'if-modified-since': new Date(MTIME_MS - 1000).toUTCString() }), null, MTIME_MS)).toBe(false);
  });

  test('with a validator but no mtime, only the validator can match', () => {
    expect(notModified(request({ 'if-none-match': ETAG }), ETAG, null)).toBe(true);
    expect(notModified(request({ 'if-none-match': '"other"' }), ETAG, null)).toBe(false);
    expect(notModified(request({ 'if-modified-since': new Date(MTIME_MS).toUTCString() }), ETAG, null)).toBe(false);
  });
});
