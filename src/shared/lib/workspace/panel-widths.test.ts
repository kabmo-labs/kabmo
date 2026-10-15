/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, test } from 'bun:test';

import {
  DEFAULT_EDITOR_FRACTIONS,
  MIN_CHAT_PANEL_WIDTH,
  MIN_EDITOR_PANEL_WIDTH,
  PAIR_MAX_FRACTION,
  PAIR_MAX_TOTAL_FRACTION,
  fillerMinWidth,
  mergePanelWidths,
  pairMaxSize,
  resolvePanelWidth,
  type PanelWidths,
} from '@/shared/lib/workspace/panel-widths';
import { DEFAULT_RIGHT_PANEL_FRACTION } from '@/shared/lib/workspace/right-panels';

describe('mergePanelWidths', () => {
  test('merging one view keeps every other remembered width', () => {
    const stored = {
      editor: { px: 620, fraction: 0.54 },
      diff: { fraction: 0.6 },
      right: { files: { px: 300, fraction: 0.26 }, git: { px: 260 } },
    };

    const merged = mergePanelWidths(stored, { right: { browser: { px: 804, fraction: 0.7 } } });

    expect(merged.right).toEqual({
      files: { px: 300, fraction: 0.26 },
      git: { px: 260 },
      browser: { px: 804, fraction: 0.7 },
    });
    expect(merged.editor).toEqual({ px: 620, fraction: 0.54 });
    expect(merged.diff).toEqual({ fraction: 0.6 });
  });

  test('the retired sidebar slot is dropped, never carried', () => {
    // A blob written while the sidebar still lived in this map holds a `left`;
    // keeping it would leave a second answer for a width that is now global.
    // Named const, not an inline cast: the runtime shape really is wider than
    // `PanelWidths`, and this is the only place that fact is expressed.
    const legacyBlob = { left: 351, editor: { px: 620 } } as unknown as PanelWidths;
    const merged = mergePanelWidths(legacyBlob, { editor: { px: 700 } });

    expect(merged).toEqual({ editor: { px: 700 } });
    expect('left' in merged).toBe(false);
  });

  test('a patch adds a unit without discarding the one already stored', () => {
    // A drag reports px + fraction together, but the conversion pass reports a
    // fraction alone; it must not erase the px fallback it was derived from.
    const merged = mergePanelWidths({ editor: { px: 620 } }, { editor: { fraction: 0.54 } });

    expect(merged.editor).toEqual({ px: 620, fraction: 0.54 });
  });

  test('a resized panel replaces only its own slot', () => {
    const merged = mergePanelWidths(
      { editor: { px: 620 }, diff: { px: 900 }, right: { files: { px: 300 } } },
      { editor: { px: 480, fraction: 0.4 } },
    );

    expect(merged).toEqual({
      editor: { px: 480, fraction: 0.4 },
      diff: { px: 900 },
      right: { files: { px: 300 } },
    });
  });
});

describe('resolvePanelWidth', () => {
  const base = {
    defaultFraction: 0.6,
    defaultPx: 600,
    min: 320,
    siblingWidth: 0,
    handleCount: 0,
  };

  test('opens at its default share of the measured area', () => {
    expect(resolvePanelWidth({ ...base, available: 1000 })).toBe(600);
  });

  test('falls back to the pixel width before the area is known', () => {
    // Not zero: a panel whose area has not been measured yet must still render
    // at the width it is supposed to open at.
    expect(resolvePanelWidth({ ...base, available: null })).toBe(600);
    expect(resolvePanelWidth({ ...base, available: null, stored: { px: 512 } })).toBe(512);
  });

  test('a px-only value holds its pixel width; only a fraction follows the area', () => {
    // The conversion is an identity (`px / available * available`), which is
    // the point: a pixel value someone chose is honoured as written rather than
    // being rescaled behind their back. It stops following the window only
    // until that slot is dragged once, which stores a fraction alongside it.
    expect(resolvePanelWidth({ ...base, available: 1000, stored: { px: 480 } })).toBe(480);
    expect(resolvePanelWidth({ ...base, available: 2000, stored: { px: 480 } })).toBe(480);
    // With both units stored, the fraction is what the panel follows.
    expect(resolvePanelWidth({ ...base, available: 2000, stored: { px: 480, fraction: 0.24 } })).toBe(480);
    expect(resolvePanelWidth({ ...base, available: 2000, stored: { px: 480, fraction: 0.3 } })).toBe(600);
  });

  test('a stored fraction beats the default share', () => {
    // 0.45 of 1000 is 450: above the 320 floor and below the 0.6 default, so
    // the result can only come from the stored fraction.
    expect(resolvePanelWidth({ ...base, available: 1000, stored: { px: 480, fraction: 0.45 } })).toBe(450);
  });

  test('the ceiling leaves the chat its floor, the siblings theirs, and the handles their width', () => {
    const available = 2000;
    // Group budget = 2000 − 400 chat − 320 sibling − 6 handles = 1274, but the
    // panel's OWN cap (0.6 × 2000 = 1200) is tighter, so it binds.
    const expected = Math.round(PAIR_MAX_FRACTION * available);

    expect(resolvePanelWidth({ ...base, available, siblingWidth: 320, handleCount: 2, stored: { fraction: 0.9 } })).toBe(expected);
  });

  test('the floor wins over a ceiling squeezed below it', () => {
    // A window too narrow for the chat floor, a sibling and this panel: the
    // panel keeps its minimum and the row clips, rather than collapsing.
    expect(resolvePanelWidth({ ...base, available: 400, siblingWidth: 320, handleCount: 2 })).toBe(320);
  });
});

describe('the editor/right-panel pair', () => {
  // The editor and the right panel share one budget: their combined share may
  // not exceed PAIR_MAX_TOTAL_FRACTION, and neither may exceed PAIR_MAX_FRACTION
  // alone. `WorkspacePanels` resolves the right panel first (reserving the
  // editor's WANTED share), then the editor (reserving the right panel's ACTUAL
  // width) — so an editor asking for more than its default makes the right
  // panel give way first.
  const available = 4000; // large enough that the pair cap binds, not the chat floor
  const rightPanelMin = 200;

  test('the defaults sum to the pair total', () => {
    expect(DEFAULT_EDITOR_FRACTIONS.editor + DEFAULT_RIGHT_PANEL_FRACTION).toBeCloseTo(PAIR_MAX_TOTAL_FRACTION, 5);
  });

  test('the defaults hold: right 0.3, editor 0.4, pair 0.7', () => {
    const editorReservePx = Math.round(DEFAULT_EDITOR_FRACTIONS.editor * available);
    const right = resolvePanelWidth({
      defaultFraction: DEFAULT_RIGHT_PANEL_FRACTION,
      defaultPx: 268,
      available,
      min: rightPanelMin,
      pairReservePx: editorReservePx,
      siblingWidth: MIN_EDITOR_PANEL_WIDTH,
      handleCount: 2,
    });
    const editor = resolvePanelWidth({
      defaultFraction: DEFAULT_EDITOR_FRACTIONS.editor,
      defaultPx: 600,
      available,
      min: MIN_EDITOR_PANEL_WIDTH,
      pairReservePx: right,
      siblingWidth: right,
      handleCount: 2,
    });
    expect(right).toBe(Math.round(0.3 * available));
    expect(editor).toBe(Math.round(0.4 * available));
    expect(editor + right).toBe(Math.round(PAIR_MAX_TOTAL_FRACTION * available));
  });

  test('an editor asking past its default makes the right panel give way', () => {
    // Editor wants 0.5; the right panel's cap becomes 0.7 − 0.5 = 0.2.
    const editorReservePx = Math.round(0.5 * available);
    const right = resolvePanelWidth({
      defaultFraction: DEFAULT_RIGHT_PANEL_FRACTION,
      defaultPx: 268,
      available,
      min: rightPanelMin,
      pairReservePx: editorReservePx,
      siblingWidth: MIN_EDITOR_PANEL_WIDTH,
      handleCount: 2,
    });
    expect(right).toBe(Math.round(0.2 * available));
    // The editor then keeps its 0.5 (pair cap = 0.7 − 0.2 = 0.5).
    const editor = resolvePanelWidth({
      stored: { fraction: 0.5 },
      defaultFraction: DEFAULT_EDITOR_FRACTIONS.editor,
      defaultPx: 600,
      available,
      min: MIN_EDITOR_PANEL_WIDTH,
      pairReservePx: right,
      siblingWidth: right,
      handleCount: 2,
    });
    expect(editor).toBe(Math.round(0.5 * available));
    expect(editor + right).toBe(Math.round(PAIR_MAX_TOTAL_FRACTION * available));
  });

  test('neither panel can exceed its own maximum while the other is open', () => {
    // A right panel asking for 0.6 (its own max) beside an editor at 0.4:
    // the pair cap holds it to 0.3.
    const right = resolvePanelWidth({
      stored: { fraction: PAIR_MAX_FRACTION },
      defaultFraction: DEFAULT_RIGHT_PANEL_FRACTION,
      defaultPx: 268,
      available,
      min: rightPanelMin,
      pairReservePx: Math.round(DEFAULT_EDITOR_FRACTIONS.editor * available),
      siblingWidth: MIN_EDITOR_PANEL_WIDTH,
      handleCount: 2,
    });
    expect(right).toBe(Math.round(0.3 * available));
  });

  test('with the sibling closed, one panel may use its own maximum', () => {
    const editor = resolvePanelWidth({
      stored: { fraction: PAIR_MAX_FRACTION },
      defaultFraction: DEFAULT_EDITOR_FRACTIONS.editor,
      defaultPx: 600,
      available,
      min: MIN_EDITOR_PANEL_WIDTH,
      pairReservePx: 0,
      siblingWidth: 0,
      handleCount: 1,
    });
    expect(editor).toBe(Math.round(PAIR_MAX_FRACTION * available));
  });
});

describe('fillerMinWidth (the chat floor that actually fits)', () => {
  test('a healthy group leaves the wish untouched', () => {
    // 1400 − (right 420 + handle 3) leaves far more than the wish.
    expect(fillerMinWidth({ available: 1400, reservedPx: 423 })).toBe(MIN_CHAT_PANEL_WIDTH);
  });

  test('a cramped group lowers the floor to what is left over', () => {
    // The 922px-window case: group 595, right panel 420 + one handle 3.
    expect(fillerMinWidth({ available: 595, reservedPx: 423 })).toBe(172);
  });

  test('a group with nothing left gives the filler no floor', () => {
    // Reserving past the group must never yield a negative min-width.
    expect(fillerMinWidth({ available: 300, reservedPx: 500 })).toBe(0);
  });

  test('no measured area means the wish stands', () => {
    expect(fillerMinWidth({ available: null, reservedPx: 423 })).toBe(MIN_CHAT_PANEL_WIDTH);
    expect(fillerMinWidth({ available: 0, reservedPx: 423 })).toBe(MIN_CHAT_PANEL_WIDTH);
  });
});

describe('pairMaxSize (the drag cap)', () => {
  const available = 4000;
  const rightMin = 200;
  const editorMin = MIN_EDITOR_PANEL_WIDTH;

  test('a closed sibling leaves the panel its own cap', () => {
    expect(pairMaxSize({ available, siblingMin: 0, siblingOpen: false })).toBe(Math.round(PAIR_MAX_FRACTION * available));
  });

  test('an open sibling reserves its FLOOR, so the panel can grow past its current width', () => {
    // Right panel's floor is 200; the editor may grow to 0.7×4000 − 200 = 2600,
    // capped by its own 0.6×4000 = 2400. Reserving the sibling's WIDTH instead
    // would pin this to the width it already has and freeze the separator.
    expect(pairMaxSize({ available, siblingMin: rightMin, siblingOpen: true })).toBe(Math.round(PAIR_MAX_FRACTION * available));
  });

  test('the smaller of the own cap and the pair remainder wins', () => {
    // A sibling whose floor is large (0.6 of the group) leaves only 0.1 — the
    // pair remainder binds.
    expect(pairMaxSize({ available, siblingMin: Math.round(0.6 * available), siblingOpen: true })).toBe(Math.round(0.1 * available));
    // A negligible floor leaves the own cap 0.6 — that one binds.
    expect(pairMaxSize({ available, siblingMin: 10, siblingOpen: true })).toBe(Math.round(PAIR_MAX_FRACTION * available));
  });

  test('no measured area means no cap', () => {
    expect(pairMaxSize({ available: null, siblingMin: editorMin, siblingOpen: true })).toBeUndefined();
  });
});
