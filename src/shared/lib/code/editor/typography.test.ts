/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The editor typography contract.
 *
 * These are the properties that make one set of constants serve two layouts at
 * any zoom level. Each one has a silent failure mode:
 *
 * - A px line-height does not scale with the font size, so zooming the editor
 *   leaves the rows at the size they were chosen for at 12px — cramped at 24,
 *   loose at 8. A ratio cannot.
 * - The stack must name the bundled face first: `Fira Code` is the only entry
 *   the app ships, so anything ahead of it would either be a font nobody has or
 *   silently change the ligatures the whole console is typeset in.
 * - The bounds must bracket the default, or the editor opens at a size its own
 *   zoom controls cannot return to (the first click jumps).
 */

import { describe, expect, test } from 'bun:test';

import {
  EDITOR_DEFAULT_FONT_FAMILY,
  EDITOR_DEFAULT_FONT_SIZE,
  EDITOR_FONT_CHOICES,
  EDITOR_FONT_FAMILY,
  EDITOR_LINE_HEIGHT,
  EDITOR_MAX_FONT_SIZE,
  EDITOR_MIN_FONT_SIZE,
  editorFontStack,
} from '@/shared/lib/code/editor/typography';

describe('editor typography', () => {
  test('the line box is a ratio, so it scales with the font size', () => {
    expect(typeof EDITOR_LINE_HEIGHT).toBe('number');
    expect(EDITOR_LINE_HEIGHT).toBeGreaterThan(1);
    expect(EDITOR_LINE_HEIGHT).toBeLessThan(3);
  });

  test('the stack leads with the bundled face and ends in a generic', () => {
    expect(EDITOR_FONT_FAMILY.startsWith('"Fira Code"')).toBe(true);
    expect(EDITOR_FONT_FAMILY.trimEnd().endsWith('monospace')).toBe(true);
  });

  test('the zoom bounds bracket the size the editor opens at', () => {
    expect(EDITOR_MIN_FONT_SIZE).toBeLessThan(EDITOR_DEFAULT_FONT_SIZE);
    expect(EDITOR_MAX_FONT_SIZE).toBeGreaterThan(EDITOR_DEFAULT_FONT_SIZE);
  });
});

describe('editorFontStack', () => {
  test('the default and an empty choice both yield the shared stack', () => {
    expect(editorFontStack(EDITOR_DEFAULT_FONT_FAMILY)).toBe(EDITOR_FONT_FAMILY);
    expect(editorFontStack('')).toBe(EDITOR_FONT_FAMILY);
    expect(editorFontStack(undefined)).toBe(EDITOR_FONT_FAMILY);
    expect(editorFontStack('   ')).toBe(EDITOR_FONT_FAMILY);
  });

  test('a chosen face is preferred, with the bundled stack still behind it', () => {
    const stack = editorFontStack('JetBrains Mono');
    expect(stack.startsWith('"JetBrains Mono"')).toBe(true);
    // The fallback is what keeps an uninstalled choice from breaking the editor.
    expect(stack).toContain(EDITOR_FONT_FAMILY);
    expect(stack.trimEnd().endsWith('monospace')).toBe(true);
  });

  test('a multi-word choice is quoted, so it stays one family name', () => {
    expect(editorFontStack('Courier New').startsWith('"Courier New"')).toBe(true);
  });

  test('the default choice is one the picker offers', () => {
    expect(EDITOR_FONT_CHOICES.map((choice) => choice.id)).toContain(EDITOR_DEFAULT_FONT_FAMILY);
  });

  test('exactly one offered face is the bundled one, and it is the default', () => {
    const bundled = EDITOR_FONT_CHOICES.filter((choice) => choice.bundled);
    expect(bundled.map((choice) => choice.id)).toEqual([EDITOR_DEFAULT_FONT_FAMILY]);
  });

  test('every choice resolves to a stack that still ends in the bundled face', () => {
    // The picker offers faces the app does not ship, so the guarantee that makes
    // that safe is per-choice: a device without the chosen face must land on
    // Fira Code rather than on a system serif or a blank cell.
    for (const choice of EDITOR_FONT_CHOICES) {
      const stack = editorFontStack(choice.id);
      expect(stack.startsWith(`"${choice.id}"`)).toBe(true);
      expect(stack).toContain(EDITOR_FONT_FAMILY);
      expect(stack.trimEnd().endsWith('monospace')).toBe(true);
    }
  });
});
