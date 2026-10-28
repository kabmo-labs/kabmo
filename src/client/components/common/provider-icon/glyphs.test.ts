/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The provider and brand art tables are generated data, and a broken entry is
 * invisible until it renders: an empty `body` draws a blank tile, a missing
 * `viewBox` makes the caller's `<svg>` fall back to its own box and the mark
 * lands the wrong size, and a baked-in hex colour paints a fixed logo on every
 * theme (the caller paints through `currentColor`). `provider-icon/index.tsx`
 * reads `glyph.viewBox` and `glyph.body` directly, so these invariants are the
 * only thing standing between the table and a silently wrong icon.
 *
 * The brand table is the same shape of contract, but for language/file logos:
 * every path is raw `d` data for the shared 24x24 box, and every colour is a
 * literal Simple Icons hex (that table DOES carry brand colours by design).
 */

import { describe, expect, test } from 'bun:test';
import { BRAND_ICONS, BRAND_VIEWBOX } from '@/client/components/common/file-icon/brand-paths';
import { PROVIDER_GLYPHS } from '@/client/components/common/provider-icon/glyphs';

describe('PROVIDER_GLYPHS', () => {
  test('every glyph has a non-empty viewBox and body', () => {
    const entries = Object.entries(PROVIDER_GLYPHS);
    expect(entries.length).toBeGreaterThan(0);
    for (const [name, glyph] of entries) {
      expect(glyph.viewBox.trim(), `${name}.viewBox`).not.toBe('');
      expect(glyph.body.trim(), `${name}.body`).not.toBe('');
    }
  });

  test('a glyph viewBox is four numbers (the caller passes it straight to <svg>)', () => {
    for (const [name, glyph] of Object.entries(PROVIDER_GLYPHS)) {
      expect(glyph.viewBox, `${name}.viewBox`).toMatch(/^-?\d+(?:\.\d+)?(?: -?\d+(?:\.\d+)?){3}$/);
    }
  });

  test('glyphs keep their own coordinate system instead of assuming 24x24', () => {
    // The sources do not share a box; a glyph refitted to a 512 or 54 box that
    // is rendered through the default 24x24 viewBox comes out wrong-sized.
    expect(PROVIDER_GLYPHS.aiand?.viewBox).toBe('0 0 296 320');
    expect(PROVIDER_GLYPHS.litellm?.viewBox).toBe('0 0 512 512');
    expect(PROVIDER_GLYPHS.synthetic?.viewBox).toBe('0 0 54 54');
    expect(PROVIDER_GLYPHS.yoloauto?.viewBox).toBe('0 0 64 64');
  });

  test('no glyph bakes in a colour: every paint is currentColor', () => {
    for (const [name, glyph] of Object.entries(PROVIDER_GLYPHS)) {
      expect(glyph.body, `${name}.body`).not.toContain('#');
      for (const match of glyph.body.matchAll(/(?:fill|stroke)="([^"]*)"/g)) {
        expect(match[1], `${name} paint`).toBe('currentColor');
      }
    }
  });

  test('structural attributes survive the fold to currentColor', () => {
    // Azure's overlapping panes rely on fill-opacity, Synthetic's mark on a
    // stroked outline; folding paint to currentColor must not have dropped them.
    expect(PROVIDER_GLYPHS.azure?.body).toContain('fill-opacity');
    expect(PROVIDER_GLYPHS.synthetic?.body).toContain('stroke-width');
  });

  test('the well-known providers are present', () => {
    expect(PROVIDER_GLYPHS.openai).toBeDefined();
    expect(PROVIDER_GLYPHS.anthropic).toBeDefined();
    expect(PROVIDER_GLYPHS.deepseek).toBeDefined();
  });
});

describe('BRAND_ICONS', () => {
  test('every brand path is raw d data for the shared 24x24 box', () => {
    expect(BRAND_VIEWBOX).toBe('0 0 24 24');
    const entries = Object.entries(BRAND_ICONS);
    expect(entries.length).toBeGreaterThan(0);
    for (const [name, icon] of entries) {
      expect(icon.path.trim(), `${name}.path`).not.toBe('');
      expect(icon.path, `${name}.path`).not.toContain('<');
      expect(icon.path, `${name}.path`).not.toContain('fill=');
    }
  });

  test('every brand colour is a literal six-digit hex', () => {
    for (const [name, icon] of Object.entries(BRAND_ICONS)) {
      expect(icon.color, `${name}.color`).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  test('a known brand keeps its official colour', () => {
    expect(BRAND_ICONS.Angular?.color).toBe('#0F0F11');
    expect(BRAND_ICONS.Kotlin?.path).toBe('M24 24H0V0h24L12 12Z');
  });
});
