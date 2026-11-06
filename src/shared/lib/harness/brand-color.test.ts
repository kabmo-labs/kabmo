/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The colour a harness mark is painted in.
 *
 * Two properties matter, and each fails silently in production:
 *
 *  - **the two omp surfaces must differ.** Both transports share one glyph, so a
 *    shared colour draws two identical marks side by side; the hue is the only
 *    thing left to tell `omp` (RPC) from `omp` (ACP) once the tab's label is gone.
 *    Every value still has to clear the non-text floor on every shipped palette,
 *    which is why the pair goes through `legiblePair` rather than a raw hex.
 *  - **an unknown key is `null`, not a guess.** A colour invented for a mark with
 *    no brand would be the only fabricated hue in the app.
 */

import { describe, expect, test } from 'bun:test';

import {
  HARNESS_BRAND_COLORS,
  HARNESS_SURFACE_COLORS,
  harnessColorFor,
} from '@/shared/lib/harness/brand-color';
import { HARNESS_CATALOG } from '@/shared/lib/harness/catalog';
import { BRAND_CONTRAST_FLOOR, worstSurfaceContrast } from '@/shared/lib/theme/legibility';

describe('harness surfaces', () => {
  test('omp over RPC keeps its purple and omp over ACP is red', () => {
    expect(HARNESS_SURFACE_COLORS['omp-rpc']?.base).toBe('#9b4dff');
    expect(HARNESS_SURFACE_COLORS['omp-acp']?.base).toBe('#dc2626');
    expect(harnessColorFor('omp-rpc', 'light')).not.toBe(harnessColorFor('omp-acp', 'light'));
  });

  test('the surface id wins over the brand key it shares', () => {
    // `omp` is the brand both transports draw; asking by ID has to answer with
    // the surface, or the override is unreachable.
    expect(HARNESS_BRAND_COLORS.omp.light).toBe(HARNESS_SURFACE_COLORS['omp-rpc']?.light);
    expect(harnessColorFor('omp-acp', 'light')).toBe(HARNESS_SURFACE_COLORS['omp-acp'].light);
    expect(harnessColorFor('omp', 'light')).toBe(HARNESS_BRAND_COLORS.omp.light);
  });

  test('every painted value clears the non-text floor on its own variant', () => {
    for (const entry of Object.values(HARNESS_SURFACE_COLORS)) {
      expect(worstSurfaceContrast(entry.light, 'light')).toBeGreaterThanOrEqual(BRAND_CONTRAST_FLOOR);
      if (entry.dark) {
        expect(worstSurfaceContrast(entry.dark, 'dark')).toBeGreaterThanOrEqual(BRAND_CONTRAST_FLOOR);
      }
    }
  });

  test('every surface names a harness this build knows', () => {
    // A typo in the table would be a rule matching nothing — a mark that keeps the
    // shared brand hue with no test to say so.
    for (const id of Object.keys(HARNESS_SURFACE_COLORS)) {
      expect(HARNESS_CATALOG[id as keyof typeof HARNESS_CATALOG]).toBeDefined();
    }
  });

  test('an unknown key has no colour rather than an invented one', () => {
    expect(harnessColorFor('some-future-agent', 'light')).toBeNull();
    expect(harnessColorFor(null, 'dark')).toBeNull();
  });
});
