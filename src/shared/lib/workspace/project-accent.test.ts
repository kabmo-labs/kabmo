/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A custom accent is user input that ends up in a CSS `color`, so the only
 * accepted shape is a hex colour and the only stored shape is lowercase
 * six-digit. These cases pin both, plus the fact that the palette has no entry
 * that is already the custom default (the picker would look like an eleventh
 * preset).
 */

import { describe, expect, test } from 'bun:test';

import {
  DEFAULT_CUSTOM_ACCENT,
  PROJECT_ACCENT_OPTIONS,
  isHexAccent,
  normalizeHexAccent,
} from '@/shared/lib/workspace/project-accent';

describe('normalizeHexAccent', () => {
  test('expands the short form and lowercases', () => {
    expect(normalizeHexAccent('#ABC')).toBe('#aabbcc');
    expect(normalizeHexAccent('#0F8')).toBe('#00ff88');
    expect(normalizeHexAccent('#38BDF8')).toBe('#38bdf8');
  });

  test('leaves a six-digit colour alone apart from case', () => {
    expect(normalizeHexAccent('#7c3aed')).toBe('#7c3aed');
    expect(normalizeHexAccent('#7C3AED')).toBe('#7c3aed');
  });

  test('refuses everything that is not a hex colour', () => {
    // A style value is not a colour: this is the injection the server now blocks.
    for (const value of ['red', 'red;background:url(//x)', 'rgb(1,2,3)', '#1234', '#1234567', '7c3aed', '#gggggg', '', ' #fff']) {
      expect(normalizeHexAccent(value)).toBeNull();
    }
  });
});

describe('isHexAccent', () => {
  test('accepts only the stored form', () => {
    expect(isHexAccent('#38bdf8')).toBe(true);
    expect(isHexAccent('#ABC')).toBe(false);
    expect(isHexAccent('')).toBe(false);
  });
});

describe('the palette table', () => {
  test('every preset is already in stored form', () => {
    for (const option of PROJECT_ACCENT_OPTIONS) {
      if (option.value === '') continue;
      expect(normalizeHexAccent(option.value)).toBe(option.value);
    }
  });

  test('the custom default is not a preset', () => {
    // Otherwise picking "custom" would highlight a swatch instead.
    expect(PROJECT_ACCENT_OPTIONS.some((option) => option.value === DEFAULT_CUSTOM_ACCENT)).toBe(false);
    expect(normalizeHexAccent(DEFAULT_CUSTOM_ACCENT)).toBe(DEFAULT_CUSTOM_ACCENT);
  });

  test('None is the only empty entry, and it comes first', () => {
    expect(PROJECT_ACCENT_OPTIONS.filter((option) => option.value === '')).toHaveLength(1);
    expect(PROJECT_ACCENT_OPTIONS[0]?.value).toBe('');
  });
});