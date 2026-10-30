/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The sidebar style setting's contract.
 *
 * The value is stored in the `kabmo_settings` blob and read on every render of
 * the left column, so the two failure modes worth pinning are:
 *
 * - **an unknown value must resolve to `classic`.** A blob written by a newer
 *   build, a hand-edited row, or a downgrade would otherwise name a renderer
 *   that does not exist in this build.
 * - **the default must stay `classic`.** It is what an upgrade renders, and the
 *   setting exists so a user opts IN to a different chrome — flipping the
 *   default silently rearranges a sidebar nobody asked to change.
 */

import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_SIDEBAR_STYLE,
  SIDEBAR_STYLES,
  SIDEBAR_STYLE_COPY,
  isSidebarStyle,
  resolveSidebarStyle,
} from '@/shared/lib/workspace/sidebar-style';

describe('resolveSidebarStyle', () => {
  test('the shipped default is classic, so an upgrade rearranges nothing', () => {
    expect(DEFAULT_SIDEBAR_STYLE).toBe('classic');
  });

  test('every style this build can draw resolves to itself', () => {
    for (const style of SIDEBAR_STYLES) {
      expect(resolveSidebarStyle(style)).toBe(style);
    }
  });

  test('an unknown value falls back to the default rather than to a missing renderer', () => {
    for (const value of ['sidebar-2', '', 'Modern', null, undefined, 0, {}, []]) {
      expect(resolveSidebarStyle(value)).toBe(DEFAULT_SIDEBAR_STYLE);
    }
  });

  test('the guard agrees with the resolver', () => {
    expect(isSidebarStyle('modern')).toBe(true);
    expect(isSidebarStyle('classic')).toBe(true);
    expect(isSidebarStyle('MODERN')).toBe(false);
  });

  test('every style has copy, so the settings card cannot render an empty label', () => {
    for (const style of SIDEBAR_STYLES) {
      expect(SIDEBAR_STYLE_COPY[style].label.length).toBeGreaterThan(0);
      expect(SIDEBAR_STYLE_COPY[style].description.length).toBeGreaterThan(0);
    }
  });
});
