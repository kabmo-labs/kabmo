/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The border style's contract.
 *
 * The rule that matters is the FALLBACK and the ABSENT state: a stored value
 * this build cannot draw must resolve to `hairline` (an upgrade that silently
 * removed every separator would be a regression wearing a new setting's name),
 * and `hairline` is exactly the state CSS paints with no attribute.
 */

import { describe, expect, test } from 'bun:test';
import {
  BORDER_ATTRIBUTE,
  BORDER_STYLES,
  BORDER_STYLE_COPY,
  BORDER_STYLE_SETTING_KEY,
  BORDER_STYLE_WITHOUT_ATTRIBUTE,
  DEFAULT_BORDER_STYLE,
  isBorderStyle,
  resolveBorderStyle,
} from '@/shared/lib/theme/border-style';

describe('isBorderStyle', () => {
  test('accepts exactly the two styles', () => {
    expect(BORDER_STYLES.map(isBorderStyle)).toEqual([true, true]);
  });

  test('refuses what another build or a corrupted blob could carry', () => {
    for (const value of ['', 'Borderless', 'none', '0', 0, 1, true, null, undefined, {}, ['borderless']]) {
      expect(isBorderStyle(value)).toBe(false);
    }
  });
});

describe('resolveBorderStyle', () => {
  test('keeps a style this build draws', () => {
    expect(resolveBorderStyle('hairline')).toBe('hairline');
    expect(resolveBorderStyle('borderless')).toBe('borderless');
  });

  test('an unknown value lands on hairline, never on a rule set that does not exist', () => {
    expect(resolveBorderStyle('naked')).toBe(DEFAULT_BORDER_STYLE);
    expect(resolveBorderStyle(undefined)).toBe(DEFAULT_BORDER_STYLE);
    expect(resolveBorderStyle(null)).toBe(DEFAULT_BORDER_STYLE);
  });

  test('an upgrade keeps its separators: the default IS the absent state', () => {
    // The two constants coincide today, and that is the point rather than an
    // accident: an install that never chose a style must keep the ruled look it
    // shipped with. A later release may move the DEFAULT while leaving the
    // ABSENT state at `hairline`; this test then fails and must be re-decided
    // deliberately, not silently.
    expect(DEFAULT_BORDER_STYLE).toBe('hairline');
    expect(BORDER_STYLE_WITHOUT_ATTRIBUTE).toBe('hairline');
  });
});

describe('the style table', () => {
  test('the attribute and the settings key are the names the writers use', () => {
    expect(BORDER_ATTRIBUTE).toBe('data-borders');
    expect(BORDER_STYLE_SETTING_KEY).toBe('borderStyle');
  });

  test('every style carries its own label, caption and description', () => {
    const labels = BORDER_STYLES.map((style) => BORDER_STYLE_COPY[style].label);
    expect(new Set(labels).size).toBe(BORDER_STYLES.length);
    for (const style of BORDER_STYLES) {
      expect(BORDER_STYLE_COPY[style].description.length).toBeGreaterThan(0);
      expect(BORDER_STYLE_COPY[style].caption.length).toBeGreaterThan(0);
    }
  });

  test('the borderless copy promises exactly what the CSS removes', () => {
    // The description is the contract a user reads: it says the separators go
    // and the controls keep their edges. If the CSS ever stops honouring that
    // split, this sentence is the thing that becomes a lie.
    expect(BORDER_STYLE_COPY.borderless.description).toContain('Fields and switches keep their edge');
  });
});
