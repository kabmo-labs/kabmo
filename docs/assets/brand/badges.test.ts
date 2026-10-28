/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The README's badge row carries three logos that shields.io cannot resolve
 * itself, so each is inlined as a base64 data URI in the badge URL. That makes
 * the README and `docs/assets/brand/*.svg` two copies of the same bytes, and
 * nothing in the build reads either one — a badge whose payload has drifted
 * from its source renders an old mark forever, with no error anywhere.
 *
 * Three failure modes are pinned here, each of which was real while this was
 * being written:
 *
 * - **Drift.** The URL is regenerated from the file, so a mark edited without
 *   re-embedding its payload fails rather than silently shipping the old one.
 * - **Encoding.** `+` is decoded as a space by a query parser and a raw `/`
 *   ends the path segment, so both — plus `=` padding — must be
 *   percent-encoded. Verified against shields: an unencoded `+` in the payload
 *   made the badge drop the logo entirely, answering 200 with no `<image>`.
 * - **shields cannot do it any other way.** There is no Simple Icons slug for
 *   Elysia or Shiki (checked against the full slug list) and `logo=<url>` is
 *   rejected, so a future edit cannot "simplify" these to a named logo.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..', '..');
const BRAND_DIR = import.meta.dir;
const README = readFileSync(join(ROOT, 'README.md'), 'utf8');

/** The badge URL each mark belongs to, keyed by the mark's file name. */
const MARKS = ['elysia', 'shiki', 'kabmo'] as const;

/** Base64 as shields requires it: `+`, `/` and `=` percent-encoded. */
function encodePayload(svg: Buffer): string {
  return svg
    .toString('base64')
    .replaceAll('+', '%2B')
    .replaceAll('/', '%2F')
    .replaceAll('=', '%3D');
}

/** Every `logo=data:image/svg%2bxml;base64,<payload>` in the README. */
function readmeLogos(): string[] {
  return [...README.matchAll(/logo=data:image\/svg%2bxml;base64,([A-Za-z0-9%]+)/g)].map(
    (match) => match[1],
  );
}

describe('README badge logos', () => {
  test('every embedded payload decodes to a mark in docs/assets/brand', () => {
    const payloads = new Set(readmeLogos());
    expect(payloads.size).toBe(MARKS.length);

    for (const name of MARKS) {
      const svg = readFileSync(join(BRAND_DIR, `${name}.svg`));
      expect(payloads.has(encodePayload(svg))).toBe(true);
    }
  });

  test('each mark is a well-formed, single-viewBox SVG', () => {
    for (const name of MARKS) {
      const svg = readFileSync(join(BRAND_DIR, `${name}.svg`), 'utf8');
      expect(svg.startsWith('<svg ')).toBe(true);
      expect(svg.endsWith('</svg>')).toBe(true);
      // One viewBox, and no width/height: shields scales the mark into its own
      // 14px logo box, and a fixed pixel size would fight that.
      expect(svg.match(/viewBox=/g)).toHaveLength(1);
      expect(svg).not.toMatch(/<svg[^>]*\s(width|height)=/);
      // No script, no external reference: the payload is user-agent-rendered
      // from a URL, so it may only contain inert geometry.
      expect(svg).not.toMatch(/<script|href=|url\(/);
    }
  });

  test('the payload is percent-encoded, never raw', () => {
    // A raw `+` survives in the URL string but decodes to a space server-side,
    // which drops the logo. The README must carry no raw `+` inside a payload.
    for (const payload of readmeLogos()) {
      expect(payload).not.toMatch(/[+/=]/);
    }
  });
});
