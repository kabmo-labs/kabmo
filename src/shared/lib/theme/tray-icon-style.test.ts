/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';

import {
  DEFAULT_TRAY_ICON_STYLE,
  TRAY_ICON_STYLES,
  TRAY_ICON_STYLE_COPY,
  isTrayIconStyle,
  resolveTrayIconStyle,
} from '@/shared/lib/theme/tray-icon-style';

describe('tray icon style', () => {
  test('the default is the shipped app icon, so an upgrade changes nothing', () => {
    expect(DEFAULT_TRAY_ICON_STYLE).toBe('color');
  });

  test('every listed style has copy and a caption', () => {
    for (const style of TRAY_ICON_STYLES) {
      expect(TRAY_ICON_STYLE_COPY[style].label.length).toBeGreaterThan(0);
      expect(TRAY_ICON_STYLE_COPY[style].description.length).toBeGreaterThan(0);
      expect(TRAY_ICON_STYLE_COPY[style].caption.length).toBeGreaterThan(0);
    }
  });

  test('a value this build cannot draw resolves to the default', () => {
    expect(resolveTrayIconStyle('monochrome')).toBe('monochrome');
    expect(resolveTrayIconStyle('color')).toBe('color');
    expect(resolveTrayIconStyle('sepia')).toBe(DEFAULT_TRAY_ICON_STYLE);
    expect(resolveTrayIconStyle(undefined)).toBe(DEFAULT_TRAY_ICON_STYLE);
    expect(resolveTrayIconStyle(null)).toBe(DEFAULT_TRAY_ICON_STYLE);
  });

  test('the guard accepts only the two styles', () => {
    expect(isTrayIconStyle('color')).toBe(true);
    expect(isTrayIconStyle('monochrome')).toBe(true);
    expect(isTrayIconStyle('Color')).toBe(false);
    expect(isTrayIconStyle(1)).toBe(false);
  });
});
