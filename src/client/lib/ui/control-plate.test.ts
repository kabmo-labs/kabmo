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
  ACTIVITY_BAR_WIDTH_PX,
  CONTROL_BOX,
  CONTROL_BOX_PX,
  CONTROL_CLUSTER_GAP,
  CONTROL_GLYPH_PX,
  CONTROL_ROW_GAP,
  navbarEdgeInsets,
  railAlignedInset,
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

  test('the navbar inset centres its last control on the activity rail', () => {
    // The navbar and the rail share the right edge, so the inset is half the
    // difference between the rail and the control that ends the row. A flat
    // `1rem` put the right-panel toggle's centre 8px off the rail's axis.
    expect(ACTIVITY_BAR_WIDTH_PX).toBe(44);
    expect(CONTROL_BOX_PX.desktop).toBe(px(CONTROL_BOX.desktop, 'w'));
    expect(CONTROL_BOX_PX.mobile).toBe(px(CONTROL_BOX.mobile, 'w'));
    expect(railAlignedInset(CONTROL_BOX_PX.desktop)).toBe('8px');
    const inset = Number.parseFloat(railAlignedInset(CONTROL_BOX_PX.desktop));
    expect(inset * 2 + CONTROL_BOX_PX.desktop).toBe(ACTIVITY_BAR_WIDTH_PX);
    // A control as wide as the rail — the Windows/Linux caption cluster — needs
    // no inset at all.
    expect(railAlignedInset(ACTIVITY_BAR_WIDTH_PX)).toBe('0px');
  });

  test('the navbar insets put each edge control on its rail axis', () => {
    // Collapsed sidebar: the navbar is the window's left edge, so the expand
    // button takes the left rail's axis. Open: the title keeps the ordinary
    // inset, and the sidebar's own header carries the window's left inset.
    expect(navbarEdgeInsets(false, CONTROL_BOX_PX.desktop)).toEqual({ left: '8px', right: '8px' });
    expect(navbarEdgeInsets(true, CONTROL_BOX_PX.desktop)).toEqual({ left: '1rem', right: '8px' });
    // A caption cluster as wide as the rail needs no right inset.
    expect(navbarEdgeInsets(false, ACTIVITY_BAR_WIDTH_PX)).toEqual({ left: '8px', right: '0px' });
  });
});
