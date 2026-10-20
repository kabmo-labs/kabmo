/**
 * The README wordmark (`public/kabmo-wordmark.svg`).
 *
 * It is a standalone asset — no app stylesheet, no font, no component — so a
 * README can embed it from any renderer. That independence is exactly why it
 * needs a test: nothing else in the repository reads the file, and every
 * property below is one a hand edit would break silently.
 *
 * The numbers are the app's own, measured from `BrandWordmark`: a 100-unit cap
 * height, the plate at `1.5625 x cap` (the icon's ink is 0.64 of its tile, so
 * the K keeps its proportions), the `a` tucked 0.28em into the plate, the
 * `b`→`m` gap widened 0.02em, and `tracking-tight` at -0.025em.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE = readFileSync(join(import.meta.dir, '../../../../../public/kabmo-wordmark.svg'), 'utf8');

function attr(name: string): string {
  const match = SOURCE.match(new RegExp(`${name}="([^"]+)"`));
  if (!match) throw new Error(`missing ${name}`);
  return match[1];
}

describe('public/kabmo-wordmark.svg', () => {
  test('is a self-contained, accessible image', () => {
    expect(SOURCE.startsWith('<?xml')).toBe(true);
    expect(SOURCE).toContain('xmlns="http://www.w3.org/2000/svg"');
    // A README's <img> gets its accessible name from the SVG itself when the
    // renderer honours it; `alt` on the <img> is the other half, and both say
    // the same thing.
    expect(attr('role')).toBe('img');
    expect(attr('aria-label')).toBe('Kabmo');
    expect(SOURCE).toContain('<title>Kabmo</title>');
    // No external dependency: a font reference or a fetched resource would fail
    // in a renderer that sandboxes images. (The xmlns URI is a namespace name,
    // never fetched, so it is not a dependency.)
    expect(SOURCE).not.toMatch(/@font-face|(?:href|src)="https?:|url\(['"]?https?:/);
  });

  test('draws the icon plate at the size the K needs', () => {
    const viewBox = attr('viewBox').split(/\s+/).map(Number);
    expect(viewBox).toHaveLength(4);
    const plate = SOURCE.match(/<rect width="([\d.]+)" height="([\d.]+)" y="([-\d.]+)"/);
    expect(plate).toBeTruthy();
    const [, w, h, y] = plate!.map(Number);
    // 1.5625 x a 100-unit cap: the icon's ink is 41 of its 64 units, so this is
    // the tile that puts the K exactly on the cap height.
    expect(w).toBe(156.25);
    expect(h).toBe(156.25);
    // The ink (41/64 of the tile) is centred on the cap band, whose top is at
    // -100 in this coordinate system.
    const inkTop = y + (h - 100) / 2;
    expect(Math.abs(inkTop + 100)).toBeLessThan(0.02);
    // The viewBox is the artwork's own bounds, so a renderer adds no padding.
    expect(Math.abs(viewBox[1] - y)).toBeLessThan(0.02);
    expect(viewBox[3]).toBeCloseTo(156.25, 1);
  });

  test('keeps the brand colours, with one ink that works on any README', () => {
    expect(SOURCE).toContain('fill="#0b5d3b"');       // plate
    expect(SOURCE).toContain('stroke="#f7f4ea"');     // stem + lower arm
    expect(SOURCE).toContain('stroke="#f26522"');     // upper arm
    expect(SOURCE).toContain('stop-color="#f59e0b"'); // a, the light end
    expect(SOURCE).toContain('stop-color="#ea580c"'); // b, the dark end
    // One ink, not a media query. A README embeds this as an image, and inside
    // an image `prefers-color-scheme` follows the CONTAINER only in Chromium —
    // WebKit resolves it from the OS. Measured: GitHub dark on a light OS
    // rendered #141310 on #0d1117 (1.02:1) in WebKit. #7e7a72 holds 4.27 on
    // white and 4.43 on GitHub dark, so it needs no switch at all.
    expect(SOURCE).toContain('.kabmo-mo { fill: #7e7a72; }');
    // No media rule at all: the ink must not depend on how the renderer
    // resolves a colour scheme, which differs between engines inside an image.
    expect(SOURCE).not.toContain('@media');
    expect(SOURCE).toContain('fill="#7e7a72"');
  });

  test('outlines the word, so no font is required', () => {
    // Three strokes plus two outlined runs: `ab` and `mo`.
    expect(SOURCE.match(/<path /g)?.length).toBe(5);
    expect(SOURCE).toContain('fill="url(#kabmo-ab)"');
    expect(SOURCE).toContain('class="kabmo-mo"');
    // Outlines are curves, not text elements a renderer could re-flow.
    expect(SOURCE).not.toContain('<text');
  });
});
