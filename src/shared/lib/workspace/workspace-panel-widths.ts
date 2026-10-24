/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The desktop workspace group's three panel widths, resolved from one place.
 *
 * `WorkspacePanels` used to compute these inline, which was correct but made the
 * component's own contract hard to read and impossible to unit-test: every rule
 * here — the two-call order, the pair caps, the leftover width a collapsed chat
 * hands the editor — is arithmetic over values the caller already has.
 *
 * Pure: no hooks, no DOM. The caller measures the group and reads the stored
 * widths; this module decides what those mean.
 */

import {
  DEFAULT_EDITOR_FRACTIONS,
  DEFAULT_EDITOR_WIDTHS,
  HANDLE_WIDTH,
  MIN_EDITOR_PANEL_WIDTH,
  panelFraction,
  pairMaxSize,
  resolvePanelWidth,
  type EditorWidthMode,
  type PanelWidths,
} from '@/shared/lib/workspace/panel-widths';
import { DEFAULT_RIGHT_PANEL_FRACTION } from '@/shared/lib/workspace/right-panels';

export interface WorkspacePanelWidthsArgs {
  /** Measured area of the group, or null before the observer reports. */
  available: number | null;
  /** This session's remembered widths. */
  panelWidths: PanelWidths;
  /** Which slot the editor column is using (a diff wants more room). */
  editorWidthMode: EditorWidthMode;
  /** The right panel's active view, whose slot and defaults apply. */
  activeRightPanel: string;
  /** The active view's own defaults and floor, when it has them. */
  activePanel?: { defaultFraction?: number; defaultWidth?: number; minWidth?: number };
  showEditor: boolean;
  showRightPanel: boolean;
  /** The chat column is collapsed, so it holds no floor and no pair share. */
  chatHidden: boolean;
}

export interface WorkspacePanelWidths {
  right: number;
  editor: number;
  /** Drag ceilings; `undefined` before the group is measured. */
  editorMax: number | undefined;
  rightMax: number | undefined;
  /** Separators actually rendered, which also consume width. */
  handleCount: number;
  /** The right panel's floor, which the drag ceiling also reserves. */
  rightMin: number;
}

export function resolveWorkspacePanelWidths(args: WorkspacePanelWidthsArgs): WorkspacePanelWidths {
  const { available, panelWidths, editorWidthMode, activeRightPanel, activePanel, showEditor, showRightPanel, chatHidden } = args;

  // The separator before the editor is gone while the chat is collapsed: there
  // is nothing on its left to transfer width to, and the drag's neighbour walk
  // skips a collapsed panel, so it would render a handle that does nothing.
  const handleCount = (showEditor && !chatHidden ? 1 : 0) + (showRightPanel ? 1 : 0);
  const rightMin = activePanel?.minWidth ?? MIN_EDITOR_PANEL_WIDTH;

  // The editor and the right panel are a COUPLED pair: the right panel is
  // resolved first, reserving the editor's WANTED share (the editor has no
  // result yet), and the editor then reserves the right panel's ACTUAL width.
  // That asymmetry is deliberate — an editor asking for more than its default
  // makes the right panel give way first, and the pair still sums to the total.
  const editorFraction = panelFraction(panelWidths[editorWidthMode], DEFAULT_EDITOR_FRACTIONS[editorWidthMode], available);
  const editorReservePx = available != null && available > 0 ? Math.round(editorFraction * available) : 0;

  const right = resolvePanelWidth({
    stored: panelWidths.right?.[activeRightPanel],
    defaultFraction: activePanel?.defaultFraction ?? DEFAULT_RIGHT_PANEL_FRACTION,
    defaultPx: activePanel?.defaultWidth ?? MIN_EDITOR_PANEL_WIDTH,
    available,
    min: rightMin,
    pairReservePx: showEditor ? editorReservePx : 0,
    // The editor has not been resolved yet, so only its floor can be reserved.
    siblingWidth: showEditor ? MIN_EDITOR_PANEL_WIDTH : 0,
    handleCount,
    chatHidden,
  });

  // With the chat collapsed the editor takes everything the right panel and the
  // separators do not. Resolving from its remembered FRACTION would leave the
  // freed width as an empty gap, which is the opposite of what the mode
  // promises; the remembered width is untouched, so leaving restores it.
  const editor = chatHidden
    ? Math.max(
        MIN_EDITOR_PANEL_WIDTH,
        available != null && available > 0
          ? Math.floor(available - (showRightPanel ? right : 0) - handleCount * HANDLE_WIDTH)
          : DEFAULT_EDITOR_WIDTHS[editorWidthMode],
      )
    : resolvePanelWidth({
        stored: panelWidths[editorWidthMode],
        defaultFraction: DEFAULT_EDITOR_FRACTIONS[editorWidthMode],
        defaultPx: DEFAULT_EDITOR_WIDTHS[editorWidthMode],
        available,
        min: MIN_EDITOR_PANEL_WIDTH,
        pairReservePx: showRightPanel ? right : 0,
        siblingWidth: showRightPanel ? right : 0,
        handleCount,
      });

  return {
    right,
    editor,
    // `resolvePanelWidth` caps what it HANDS to `defaultSize`, but a separator
    // drag bypasses it — the resizer transfers pixels between two panels clamped
    // only by their own `maxSize`. Each max is its own cap and the pair total
    // minus the sibling's FLOOR (it gives way down to its minimum mid-drag).
    editorMax: pairMaxSize({ available, siblingMin: rightMin, siblingOpen: showRightPanel, chatHidden }),
    rightMax: pairMaxSize({ available, siblingMin: MIN_EDITOR_PANEL_WIDTH, siblingOpen: showEditor, chatHidden }),
    handleCount,
    rightMin,
  };
}
