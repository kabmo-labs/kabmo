/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';
import { GLASS_LIMIT_COPY, glassLimits, type GlassLimit } from '@/shared/lib/theme/glass-support';

describe('glass support', () => {
  test('a supported engine with no preference reports nothing', () => {
    expect(glassLimits({ backdropFilter: true, reducedTransparency: false })).toEqual([]);
  });

  test('a missing backdrop-filter is named even when the system also asked for less transparency', () => {
    // The ORDER is the point: with no blur, the media query has nothing to switch
    // off, so naming the preference first would send the reader to an OS setting
    // that changes nothing on that engine.
    expect(glassLimits({ backdropFilter: false, reducedTransparency: true })).toEqual([
      'no-backdrop-filter',
      'reduced-transparency',
    ]);
  });

  test('reduced transparency alone is a limit, because the frost really is off', () => {
    expect(glassLimits({ backdropFilter: true, reducedTransparency: true })).toEqual([
      'reduced-transparency',
    ]);
  });

  test('every limit has copy long enough to act on', () => {
    const limits: GlassLimit[] = ['no-backdrop-filter', 'reduced-transparency'];
    for (const limit of limits) {
      // A limit with no sentence is a warning nobody can act on; the number is the
      // shortest of the two shipped strings.
      expect(GLASS_LIMIT_COPY[limit].length).toBeGreaterThan(80);
    }
  });
});
