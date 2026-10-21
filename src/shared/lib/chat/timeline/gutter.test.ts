/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The transcript's frame inset.
 *
 * One rule, four call sites — so it is stated here and asserted, not repeated
 * as a class string. The bug it prevents was measured on a phone: every framed
 * block carried `mx-3` on top of the timeline's own `px-3`, putting cards at
 * 24px while the composer's card sat at 12px. The transcript read as two
 * columns that never met.
 */

import { describe, expect, test } from 'bun:test';
import { transcriptBlockPadding, transcriptGutter } from '@/shared/lib/chat/timeline/gutter';

describe('transcriptGutter', () => {
  test('a phone adds no inset — the timeline container IS the gutter', () => {
    expect(transcriptGutter(true)).toBe('');
  });

  test('desktop keeps the 12px inset that pairs with the panel p-4', () => {
    expect(transcriptGutter(false)).toBe('mx-3');
  });
});

describe('transcriptBlockPadding', () => {
  test('a phone pads to the shared 24px text column (12 frame + 12 padding)', () => {
    expect(transcriptBlockPadding(true)).toBe('p-3');
  });

  test('desktop keeps its roomier 14px padding', () => {
    expect(transcriptBlockPadding(false)).toBe('p-3.5');
  });
});
