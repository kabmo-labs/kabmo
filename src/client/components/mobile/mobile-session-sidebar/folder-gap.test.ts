/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The phone drawer's folder gap.
 *
 * A closed workspace is a row in the list, not a section of it, so it takes a
 * row-sized gap — the reported "folder yang tertutup jaraknya terlalu jauh".
 * The rule is unit-tested because the failure is a MEASUREMENT (a mounted
 * happy-dom tree resolves no layout, so a component test can only read back the
 * class it was given); `mobile.e2e.ts` pins the pixels.
 */

import { describe, expect, test } from 'bun:test';
import {
  FOLDER_GAP_COLLAPSED,
  FOLDER_GAP_EXPANDED,
  folderGroupGap,
} from '@/client/components/mobile/mobile-session-sidebar/folder-gap';

describe('mobile folder group gap', () => {
  test('a closed folder takes a row-sized gap', () => {
    expect(folderGroupGap(false)).toBe(FOLDER_GAP_COLLAPSED);
    // The bug: `mb-4` on a closed folder put two of them 59px apart on a
    // 390px phone, with 39px of blank ink between their names.
    expect(folderGroupGap(false)).not.toBe(FOLDER_GAP_EXPANDED);
  });

  test('an open folder keeps the group gap', () => {
    expect(folderGroupGap(true)).toBe(FOLDER_GAP_EXPANDED);
  });

  test('the two gaps differ, and the closed one is the smaller step', () => {
    // `mb-1` = 4px, `mb-4` = 16px. Written as the Tailwind steps they are, so
    // a rename that swapped the two cannot pass by keeping them unequal.
    expect(FOLDER_GAP_COLLAPSED).toBe('mb-1');
    expect(FOLDER_GAP_EXPANDED).toBe('mb-4');
  });
});
