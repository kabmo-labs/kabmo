/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Whether the right panel may be on screen at all.
 *
 * The width resolver already capped the panel's own size, but a cap cannot
 * help a panel whose FLOOR does not fit: `resolvePanelWidth`'s ceiling is
 * `max(min, …)`, so the floor wins and the group overflows its own box. The
 * group is `flex-1 min-w-0`, so the overflow is invisible in `clientWidth` and
 * unreachable — measured on the running console at 900px: group clientWidth
 * 483 against scrollWidth 522, with 39px of the Files panel laid out past the
 * viewport edge under the activity bar.
 *
 * The answer is a DROP, not a squeeze: the chat keeps `MIN_CHAT_READING_WIDTH`
 * and the secondary column gives way. These cases pin the arithmetic, the
 * two-report contract the caller branches on, and the fact that a group with no
 * measurement yet does not close a panel it was asked to open.
 */

import { describe, expect, test } from 'bun:test';

import { HANDLE_WIDTH, MIN_EDITOR_PANEL_WIDTH } from '@/shared/lib/workspace/panel-widths';
import {
  MIN_CHAT_READING_WIDTH,
  resolveWorkspacePanelWidths,
  rightPanelFits,
} from '@/shared/lib/workspace/workspace-panel-widths';

describe('rightPanelFits', () => {
  test('a group with no measurement yet keeps the requested layout', () => {
    // The first paint happens before the observer reports; closing a panel for
    // one frame and opening it again is worse than trusting the request.
    expect(rightPanelFits({ available: null, showEditor: true, chatHidden: false, rightMin: 200, handleCount: 2 })).toBe(true);
    expect(rightPanelFits({ available: 0, showEditor: true, chatHidden: false, rightMin: 200, handleCount: 2 })).toBe(true);
  });

  test('the chat keeps its reading width and the editor its floor', () => {
    const needed = MIN_CHAT_READING_WIDTH + MIN_EDITOR_PANEL_WIDTH + 200 + 2 * HANDLE_WIDTH;
    expect(rightPanelFits({ available: needed, showEditor: true, chatHidden: false, rightMin: 200, handleCount: 2 })).toBe(true);
    expect(rightPanelFits({ available: needed - 1, showEditor: true, chatHidden: false, rightMin: 200, handleCount: 2 })).toBe(false);
  });

  test('with the chat collapsed only the editor and the panel are reserved', () => {
    // The chat column is off screen in compact/full view, so it holds no floor.
    expect(rightPanelFits({ available: MIN_EDITOR_PANEL_WIDTH + 200 + 2 * HANDLE_WIDTH, showEditor: true, chatHidden: true, rightMin: 200, handleCount: 2 })).toBe(true);
  });
});

describe('resolveWorkspacePanelWidths and the right panel', () => {
  const base = {
    panelWidths: {},
    editorWidthMode: 'editor' as const,
    activeRightPanel: 'files',
    activePanel: { defaultWidth: 268, defaultFraction: 0.3, minWidth: 200 },
    chatHidden: false,
  };

  test('a group too narrow for all three drops the right panel instead of clipping it', () => {
    // 607px is what a 1024px window leaves this group once the 414px sidebar
    // takes its share — the width where the chat measured 81px and the right
    // panel's own 200px floor pushed the row past its box.
    const resolved = resolveWorkspacePanelWidths({ ...base, available: 607, showEditor: true, showRightPanel: true });

    expect(resolved.rightShown).toBe(false);
    expect(resolved.rightSuppressed).toBe(true);
    expect(resolved.right).toBe(0);
    // The separator before the editor stays; the one before the dropped panel
    // goes with it, or the drag would transfer pixels into nothing.
    expect(resolved.handleCount).toBe(1);
  });

  test('a suppressed panel gives the chat everything the editor does not need', () => {
    const resolved = resolveWorkspacePanelWidths({ ...base, available: 607, showEditor: true, showRightPanel: true });

    // The editor keeps its floor, and the chat takes the rest — 284px where the
    // panel used to leave it 81. The editor's floor is not negotiable (it is
    // only on screen because the user opened a file), so this is the most the
    // chat can have at this group width.
    expect(resolved.editor).toBe(MIN_EDITOR_PANEL_WIDTH);
    expect(607 - resolved.editor - resolved.handleCount * HANDLE_WIDTH).toBe(284);
  });

  test('a group with room keeps the panel, and reports it as shown', () => {
    const resolved = resolveWorkspacePanelWidths({ ...base, available: 1023, showEditor: true, showRightPanel: true });

    expect(resolved.rightShown).toBe(true);
    expect(resolved.rightSuppressed).toBe(false);
    expect(resolved.right).toBeGreaterThanOrEqual(200);
    expect(resolved.handleCount).toBe(2);
  });

  test('a panel nobody asked for is neither shown nor suppressed', () => {
    const resolved = resolveWorkspacePanelWidths({ ...base, available: 400, showEditor: false, showRightPanel: false });

    expect(resolved.rightShown).toBe(false);
    // "Suppressed" means "asked for and refused" — a closed panel is not a
    // refusal, and reporting it as one would make the toggle explain a state
    // the user is not in.
    expect(resolved.rightSuppressed).toBe(false);
    expect(resolved.right).toBe(0);
  });
});
