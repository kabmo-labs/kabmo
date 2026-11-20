/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The chat column's width mode.
 *
 * The rule that matters is the FALLBACK: a stored value this build cannot draw
 * must resolve to the shipped default, never to `undefined` — an attribute CSS
 * has no rule for would leave the column at whatever the previous mode set.
 */

import { describe, expect, test } from 'bun:test';
import {
  CHAT_WIDTH_MODE_COPY,
  CHAT_WIDTH_MODES,
  CHAT_WIDTH_PRESETS,
  DEFAULT_CHAT_WIDTH_MODE,
  DEFAULT_CUSTOM_CHAT_COLUMN_WIDTH,
  MAX_CHAT_COLUMN_WIDTH,
  MIN_CHAT_COLUMN_WIDTH,
  isChatWidthMode,
  resolveChatColumnWidth,
  resolveChatWidthMode,
} from '@/shared/lib/chat/timeline/width-mode';

describe('isChatWidthMode', () => {
  test('accepts exactly the four modes', () => {
    expect(CHAT_WIDTH_MODES.map(isChatWidthMode)).toEqual([true, true, true, true]);
  });

  test('the presets are the fixed three; custom is a stored state, not a preset', () => {
    expect([...CHAT_WIDTH_PRESETS]).toEqual(['compact', 'wide', 'full']);
    expect([...CHAT_WIDTH_MODES]).toEqual([...CHAT_WIDTH_PRESETS, 'custom']);
  });

  test('refuses what another build or a corrupted blob could carry', () => {
    for (const value of ['', 'Wide', 'full-width', 'narrow', 0, 1, null, undefined, {}, ['wide']]) {
      expect(isChatWidthMode(value)).toBe(false);
    }
  });
});

describe('resolveChatWidthMode', () => {
  test('keeps a mode this build draws', () => {
    expect(resolveChatWidthMode('compact')).toBe('compact');
    expect(resolveChatWidthMode('full')).toBe('full');
    expect(resolveChatWidthMode('custom')).toBe('custom');
  });

  test('an unknown value lands on the shipped default, not on undefined', () => {
    expect(resolveChatWidthMode('ultra')).toBe(DEFAULT_CHAT_WIDTH_MODE);
    expect(resolveChatWidthMode(undefined)).toBe(DEFAULT_CHAT_WIDTH_MODE);
    expect(resolveChatWidthMode(null)).toBe(DEFAULT_CHAT_WIDTH_MODE);
  });
});

describe('resolveChatColumnWidth', () => {
  test('keeps a width a drag can produce, rounded to a pixel', () => {
    expect(resolveChatColumnWidth(900)).toBe(900);
    expect(resolveChatColumnWidth(900.4)).toBe(900);
  });

  test('clamps a stored value into the layout the column can draw', () => {
    expect(resolveChatColumnWidth(10)).toBe(MIN_CHAT_COLUMN_WIDTH);
    expect(resolveChatColumnWidth(99_999)).toBe(MAX_CHAT_COLUMN_WIDTH);
  });

  test('a value that is not a finite number lands on the default, not on NaN', () => {
    for (const value of [undefined, null, '900', Number.NaN, Number.POSITIVE_INFINITY, {}]) {
      expect(resolveChatColumnWidth(value)).toBe(DEFAULT_CUSTOM_CHAT_COLUMN_WIDTH);
    }
    // A drag that divided by a zero-width panel is the real source of `NaN`;
    // CSS ignores it while the attribute would still claim `custom`.
    expect(Number.isFinite(resolveChatColumnWidth(0 / 0))).toBe(true);
  });
});

describe('the mode table', () => {
  test('the default is one of the modes the control can pick', () => {
    expect(CHAT_WIDTH_MODES).toContain(DEFAULT_CHAT_WIDTH_MODE);
  });

  test('every mode carries its own label and description', () => {
    const labels = CHAT_WIDTH_MODES.map((mode) => CHAT_WIDTH_MODE_COPY[mode].label);
    expect(new Set(labels).size).toBe(CHAT_WIDTH_MODES.length);
    for (const mode of CHAT_WIDTH_MODES) {
      expect(CHAT_WIDTH_MODE_COPY[mode].description.length).toBeGreaterThan(0);
    }
  });
});
