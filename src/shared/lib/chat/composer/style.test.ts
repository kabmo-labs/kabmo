/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';
import {
  COMPOSER_STYLES,
  COMPOSER_STYLE_COPY,
  DEFAULT_COMPOSER_STYLE,
  composerStyleLayout,
  isComposerStyle,
  resolveComposerStyle,
  type ComposerRow,
} from '@/shared/lib/chat/composer/style';

/**
 * Every row the composer renders. The list is EXHAUSTIVE BY CONTRACT: a style
 * that omits one is a style that drops a control the user cannot get back —
 * the worst case being the access-mode selector, which decides whether a turn
 * may write to disk.
 */
const EVERY_ROW: readonly ComposerRow[] = ['attachments', 'notice', 'draft', 'voice', 'toolbar'];

describe('composer style table', () => {
  test('every style renders every row exactly once', () => {
    for (const style of COMPOSER_STYLES) {
      for (const hero of [false, true]) {
        const { rows } = composerStyleLayout({ style, hero });
        expect(new Set(rows)).toEqual(new Set(EVERY_ROW));
        expect(rows.length).toBe(EVERY_ROW.length);
      }
    }
  });

  test('every style has copy in the settings control', () => {
    for (const style of COMPOSER_STYLES) {
      expect(COMPOSER_STYLE_COPY[style].label.length).toBeGreaterThan(0);
      expect(COMPOSER_STYLE_COPY[style].description.length).toBeGreaterThan(20);
    }
  });

  test('the wireframe lists only rows the renderer draws', () => {
    for (const style of COMPOSER_STYLES) {
      const { wire } = composerStyleLayout({ style, hero: false });
      expect(wire.length).toBeGreaterThan(0);
      for (const row of wire) expect(['chip', 'draft', 'controls']).toContain(row);
    }
  });

  test('the draft is above the toolbar in every style', () => {
    // The one ordering invariant that is not cosmetic: the box a user types
    // into must not sit under the row of controls it belongs to.
    for (const style of COMPOSER_STYLES) {
      const { rows } = composerStyleLayout({ style, hero: false });
      expect(rows.indexOf('draft')).toBeLessThan(rows.indexOf('toolbar'));
    }
  });

  test('the notice stays attached to the draft it refuses', () => {
    // A refusal rendered above the attachment row would read as a complaint
    // about the file rather than about the send.
    for (const style of COMPOSER_STYLES) {
      const { rows } = composerStyleLayout({ style, hero: false });
      expect(Math.abs(rows.indexOf('notice') - rows.indexOf('draft'))).toBe(1);
    }
  });

  test('only the console style draws a mono rail and a prompt glyph', () => {
    for (const style of COMPOSER_STYLES) {
      const layout = composerStyleLayout({ style, hero: false });
      const console = style === 'console';
      expect(layout.toolbarTone).toBe(console ? 'rail' : 'plain');
      expect(layout.promptGlyph).toBe(console);
    }
  });

  test('stage alone reacts to an empty chat, and only through the hero attribute', () => {
    const docked = composerStyleLayout({ style: 'stage', hero: false });
    const hero = composerStyleLayout({ style: 'stage', hero: true });
    // Same rows: the hero state may never add or drop a control.
    expect(hero.rows).toEqual(docked.rows);
    // The pixel difference is CSS's, keyed by this attribute — see the
    // `[data-composer-hero]` rules in `tailwind.css`.
    expect(hero.hero).toBe(true);
    expect(docked.hero).toBe(false);

    for (const style of COMPOSER_STYLES.filter((s) => s !== 'stage')) {
      expect(composerStyleLayout({ style, hero: true }).hero).toBe(false);
    }
  });

  test('glass keeps the classic row order — it changes the surface, not the order', () => {
    expect(composerStyleLayout({ style: 'glass', hero: false }).rows).toEqual(
      composerStyleLayout({ style: 'classic', hero: false }).rows,
    );
    expect(composerStyleLayout({ style: 'glass', hero: false }).toolbarTone).toBe('plain');
    expect(composerStyleLayout({ style: 'glass', hero: false }).promptGlyph).toBe(false);
  });

  test('calm and console move the draft above the attachment chips', () => {
    for (const style of ['calm', 'console'] as const) {
      const { rows } = composerStyleLayout({ style, hero: false });
      expect(rows.indexOf('draft')).toBeLessThan(rows.indexOf('attachments'));
    }
    expect(composerStyleLayout({ style: 'classic', hero: false }).rows.indexOf('attachments')).toBe(0);
  });
});

describe('composer style resolution', () => {
  test('the shipped default is classic, so an upgrade rearranges nothing', () => {
    expect(DEFAULT_COMPOSER_STYLE).toBe('classic');
    expect(resolveComposerStyle(undefined)).toBe('classic');
  });

  test('a stored style this build draws is returned unchanged', () => {
    for (const style of COMPOSER_STYLES) expect(resolveComposerStyle(style)).toBe(style);
  });

  test('a value from another build falls back rather than rendering nothing', () => {
    expect(resolveComposerStyle('neon')).toBe('classic');
    expect(resolveComposerStyle(null)).toBe('classic');
    expect(resolveComposerStyle(7)).toBe('classic');
    expect(isComposerStyle('neon')).toBe(false);
  });
});
