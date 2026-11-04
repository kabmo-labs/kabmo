/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The surface style's contract.
 *
 * The rule that matters is the FALLBACK and the DEFAULT: a stored value this
 * build cannot draw must resolve to the shipped default, and that default must
 * be the opaque style — a document that resolved to `glass` by accident would
 * restyle every window on upgrade.
 */

import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_SURFACE_STYLE,
  SURFACE_ATTRIBUTE,
  SURFACE_STYLES,
  SURFACE_STYLE_COPY,
  isSurfaceStyle,
  resolveSurfaceStyle,
} from '@/shared/lib/theme/surface-style';

describe('isSurfaceStyle', () => {
  test('accepts exactly the two styles', () => {
    expect(SURFACE_STYLES.map(isSurfaceStyle)).toEqual([true, true]);
  });

  test('refuses what another build or a corrupted blob could carry', () => {
    for (const value of ['', 'Glass', 'frosted', 'blurred', 0, 1, true, null, undefined, {}, ['glass']]) {
      expect(isSurfaceStyle(value)).toBe(false);
    }
  });
});

describe('resolveSurfaceStyle', () => {
  test('keeps a style this build draws', () => {
    expect(resolveSurfaceStyle('classic')).toBe('classic');
    expect(resolveSurfaceStyle('glass')).toBe('glass');
  });

  test('an unknown value lands on the shipped default, not on undefined', () => {
    expect(resolveSurfaceStyle('liquid')).toBe(DEFAULT_SURFACE_STYLE);
    expect(resolveSurfaceStyle(undefined)).toBe(DEFAULT_SURFACE_STYLE);
    expect(resolveSurfaceStyle(null)).toBe(DEFAULT_SURFACE_STYLE);
  });
});

describe('the style table', () => {
  test('the default is the opaque style, so an upgrade restyles nothing', () => {
    expect(DEFAULT_SURFACE_STYLE).toBe('classic');
    expect(SURFACE_STYLES).toContain(DEFAULT_SURFACE_STYLE);
  });

  test('the attribute is a plain `data-` name', () => {
    expect(SURFACE_ATTRIBUTE).toBe('data-surface');
  });

  test('every style carries its own label, caption and description', () => {
    const labels = SURFACE_STYLES.map((style) => SURFACE_STYLE_COPY[style].label);
    expect(new Set(labels).size).toBe(SURFACE_STYLES.length);
    for (const style of SURFACE_STYLES) {
      expect(SURFACE_STYLE_COPY[style].description.length).toBeGreaterThan(0);
      expect(SURFACE_STYLE_COPY[style].caption.length).toBeGreaterThan(0);
    }
  });
});
