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
  DEFAULT_CHAT_WIDTH_MODE,
  isChatWidthMode,
  resolveChatWidthMode,
} from '@/shared/lib/chat/timeline/width-mode';

describe('isChatWidthMode', () => {
  test('accepts exactly the three modes', () => {
    expect(CHAT_WIDTH_MODES.map(isChatWidthMode)).toEqual([true, true, true]);
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
  });

  test('an unknown value lands on the shipped default, not on undefined', () => {
    expect(resolveChatWidthMode('ultra')).toBe(DEFAULT_CHAT_WIDTH_MODE);
    expect(resolveChatWidthMode(undefined)).toBe(DEFAULT_CHAT_WIDTH_MODE);
    expect(resolveChatWidthMode(null)).toBe(DEFAULT_CHAT_WIDTH_MODE);
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
