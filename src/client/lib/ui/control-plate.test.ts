/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The chrome-row density: one box, one gap, every row.
 *
 * This module exists because the navbar stated its own numbers and drifted from
 * the sidebar's action row — measured, the phone header's glyphs sat 48px apart
 * against the drawer's 38px, and the header read as controls floating apart.
 * The assertions below are the contract that drift has to break to come back:
 * the box is a fixed square (not padding, which makes the pitch depend on the
 * glyph's own width), the mobile box is the drawer's 36px rather than the
 * standalone 44px touch floor, and both rows take the same gap.
 */

import { describe, expect, test } from 'bun:test';
import {
  CONTROL_BOX,
  CONTROL_CLUSTER_GAP,
  CONTROL_GLYPH_PX,
  CONTROL_ROW_GAP,
  type ControlLayout,
} from '@/client/lib/ui/control-plate';

/** The px a Tailwind `w-7`-style class resolves to: the scale step is 4px. */
const px = (token: string, axis: 'w' | 'h'): number => {
  const match = new RegExp(`\\b${axis}-(\\d+(?:\\.\\d+)?)\\b`).exec(token);
  if (!match) throw new Error(`no ${axis} in "${token}"`);
  return Number(match[1]) * 4;
};

const GAPS = { 'gap-0.5': 2, 'gap-1': 4 } as const;

describe('control plate', () => {
  test('the box is a fixed square on both layouts', () => {
    // Padding would make the pitch depend on the glyph: a 16px icon in a 36px
    // box is the same box a 18px icon gets, which is what lets the two rows
    // share one density.
    for (const layout of ['desktop', 'mobile'] as ControlLayout[]) {
      const box = CONTROL_BOX[layout];
      expect(box).not.toContain('p-1.5');
      expect(px(box, 'w')).toBe(px(box, 'h'));
    }
    expect(px(CONTROL_BOX.desktop, 'w')).toBe(28);
    expect(px(CONTROL_BOX.mobile, 'w')).toBe(36);
  });

  test('a phone box is the drawer row, not the standalone 44px floor', () => {
    // `.tap-target` is the floor for a control that stands ALONE. A dense row
    // takes the row density instead — and a 44px box here is the airiness this
    // module was written to remove.
    expect(CONTROL_BOX.mobile).not.toContain('tap-target');
    expect(px(CONTROL_BOX.mobile, 'w')).toBeLessThan(44);
  });

  test('the glyph fits inside the box with room to breathe', () => {
    for (const layout of ['desktop', 'mobile'] as ControlLayout[]) {
      const inset = (px(CONTROL_BOX[layout], 'w') - CONTROL_GLYPH_PX[layout]) / 2;
      expect(inset).toBeGreaterThanOrEqual(5);
    }
  });

  test('one gap between controls, one between clusters', () => {
    expect(GAPS[CONTROL_ROW_GAP as keyof typeof GAPS]).toBe(2);
    expect(GAPS[CONTROL_CLUSTER_GAP as keyof typeof GAPS]).toBe(4);
  });

  test('the pitch the rows now share', () => {
    // glyph centre to glyph centre — the number a reader perceives as spacing.
    const gap = GAPS[CONTROL_ROW_GAP as keyof typeof GAPS];
    expect(px(CONTROL_BOX.desktop, 'w') + gap).toBe(30);
    expect(px(CONTROL_BOX.mobile, 'w') + gap).toBe(38);
  });
});
