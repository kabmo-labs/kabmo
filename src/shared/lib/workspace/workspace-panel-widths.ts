/**
 * @license
 * SPDX-License-Identifier: MIT
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
import type { PanelNavStyle } from '@/shared/lib/workspace/panel-nav';

/**
 * The width below which the chat column stops being a conversation, used to
 * decide whether a SECONDARY panel may exist at all.
 *
 * `MIN_CHAT_PANEL_WIDTH` is the share the chat is BUDGETED, and it is a wish:
 * when the group cannot spare it the chat narrows rather than the fixed panels
 * clipping. But that wish cannot answer "should the right panel be on screen at
 * this window width", because a 400px chat beside a 320px editor and a 200px
 * file tree needs 926px of group — which no 1152px window has once the sidebar
 * takes its share. The old answer was to keep all three and let the chat fall
 * to 209px (measured at 1152) and then to 0 (measured at 900), with the group's
 * own scrollWidth past its clientWidth so the right panel was clipped by the
 * viewport with no scrollbar to reach it.
 *
 * 320 is the floor the composer's toolbar actually needs: below `@[420px]` every
 * selector is icon-only (`ModeToggles`, `AccessDropdown`, `ThinkingLevelDropdown`),
 * and 320 leaves a 24px-gutter message column about 40 characters wide. At 320
 * the chat is cramped but whole; at 209 it is a column of clipped chips.
 */
export const MIN_CHAT_READING_WIDTH = 320;

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
  /**
   * The right panel is ON SCREEN: it was asked for and the group can hold it.
   * The caller renders the column, its separator and the rail from this, never
   * from its own `showRightPanel` request — otherwise a refused request draws a
   * rail beside a panel that is not there.
   */
  rightShown: boolean;
  /**
   * The right panel was ASKED for and there is no room for it. The caller says
   * so (a refusal names its reason) instead of leaving a toggle that flips a
   * flag the layout is ignoring.
   */
  rightSuppressed: boolean;
  /** Drag ceilings; `undefined` before the group is measured. */
  editorMax: number | undefined;
  rightMax: number | undefined;
  /** Separators actually rendered, which also consume width. */
  handleCount: number;
  /** The right panel's floor, which the drag ceiling also reserves. */
  rightMin: number;
}

/**
 * Whether the right panel can be on screen beside everything else.
 *
 * A panel whose floor does not fit is DROPPED, not clipped and not squeezed:
 * `resolvePanelWidth`'s ceiling is `max(min, …)`, so a floor that does not fit
 * can only overflow the group. The group is `flex-1 min-w-0`, so its
 * `clientWidth` stays put while its `scrollWidth` grows — the panel is laid out
 * PAST the viewport edge, under the activity bar, with no scrollbar that could
 * bring it back (measured at 900px: group 483 vs scroll 522, 39px of the Files
 * panel unreachable).
 *
 * The chat is the surface the app exists for, so it keeps `MIN_CHAT_READING_WIDTH`
 * and the SECONDARY column is the one that gives way. The editor column never
 * gives way: it is only on screen because the user opened a file or a takeover,
 * and a click that opened nothing would be the worse defect.
 */
export function rightPanelFits(args: {
  /** Measured area of the group, or null before the observer reports. */
  available: number | null;
  showEditor: boolean;
  /** The chat is collapsed, so it reserves nothing. */
  chatHidden: boolean;
  /** The right panel's own floor, from the view it would draw. */
  rightMin: number;
  /** Separators the row would hold WITH the right panel present. */
  handleCount: number;
}): boolean {
  const { available, showEditor, chatHidden, rightMin, handleCount } = args;
  // Before the group is measured there is nothing to decide from, so the
  // requested layout stands: the first paint must not open a panel and close it
  // one frame later.
  if (available === null || available <= 0) return true;
  const chatFloor = chatHidden ? 0 : MIN_CHAT_READING_WIDTH;
  const editorFloor = showEditor && !chatHidden ? MIN_EDITOR_PANEL_WIDTH : 0;
  return available >= chatFloor + editorFloor + rightMin + handleCount * HANDLE_WIDTH;
}

export function resolveWorkspacePanelWidths(args: WorkspacePanelWidthsArgs): WorkspacePanelWidths {
  const { available, panelWidths, editorWidthMode, activeRightPanel, activePanel, showEditor, showRightPanel, chatHidden } = args;

  const rightMin = activePanel?.minWidth ?? MIN_EDITOR_PANEL_WIDTH;
  // The fit question is asked with the handles the row WOULD have, because the
  // answer decides whether one of them exists.
  const requestedHandleCount = (showEditor && !chatHidden ? 1 : 0) + 1;
  const rightFits =
    showRightPanel && rightPanelFits({ available, showEditor, chatHidden, rightMin, handleCount: requestedHandleCount });
  // The separator before the editor is gone while the chat is collapsed: there
  // is nothing on its left to transfer width to, and the drag's neighbour walk
  // skips a collapsed panel, so it would render a handle that does nothing.
  const handleCount = (showEditor && !chatHidden ? 1 : 0) + (rightFits ? 1 : 0);
  const showRight = rightFits;

  // The editor and the right panel are a COUPLED pair: the right panel is
  // resolved first, reserving the editor's WANTED share (the editor has no
  // result yet), and the editor then reserves the right panel's ACTUAL width.
  // That asymmetry is deliberate — an editor asking for more than its default
  // makes the right panel give way first, and the pair still sums to the total.
  const editorFraction = panelFraction(panelWidths[editorWidthMode], DEFAULT_EDITOR_FRACTIONS[editorWidthMode], available);
  const editorReservePx = available != null && available > 0 ? Math.round(editorFraction * available) : 0;

  const right = showRight
    ? resolvePanelWidth({
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
      })
    : 0;

  // With the chat collapsed the editor takes everything the right panel and the
  // separators do not. Resolving from its remembered FRACTION would leave the
  // freed width as an empty gap, which is the opposite of what the mode
  // promises; the remembered width is untouched, so leaving restores it.
  const editor = chatHidden
    ? Math.max(
        MIN_EDITOR_PANEL_WIDTH,
        available != null && available > 0
          ? Math.floor(available - (showRight ? right : 0) - handleCount * HANDLE_WIDTH)
          : DEFAULT_EDITOR_WIDTHS[editorWidthMode],
      )
    : resolvePanelWidth({
        stored: panelWidths[editorWidthMode],
        defaultFraction: DEFAULT_EDITOR_FRACTIONS[editorWidthMode],
        defaultPx: DEFAULT_EDITOR_WIDTHS[editorWidthMode],
        available,
        min: MIN_EDITOR_PANEL_WIDTH,
        pairReservePx: showRight ? right : 0,
        siblingWidth: showRight ? right : 0,
        handleCount,
      });

  return {
    right,
    editor,
    rightShown: showRight,
    rightSuppressed: showRightPanel && !showRight,
    // `resolvePanelWidth` caps what it HANDS to `defaultSize`, but a separator
    // drag bypasses it — the resizer transfers pixels between two panels clamped
    // only by their own `maxSize`. Each max is its own cap and the pair total
    // minus the sibling's FLOOR (it gives way down to its minimum mid-drag).
    editorMax: pairMaxSize({ available, siblingMin: rightMin, siblingOpen: showRight, chatHidden }),
    rightMax: pairMaxSize({ available, siblingMin: MIN_EDITOR_PANEL_WIDTH, siblingOpen: showEditor, chatHidden }),
    handleCount,
    rightMin,
  };
}

/**
 * Whether the right activity rail is on screen.
 *
 * The rail is how a view is CHOSEN, so it exists where choosing one can still
 * put something on screen. That is `sideShown && !rightSuppressed` — NOT
 * `rightPanelShown`: a panel closed by its own control is not suppressed, and
 * taking the rail away with it left the column unreachable except through the
 * navbar's chord (measured by `files-nested.e2e.ts`, whose `openFiles` reopens a
 * collapsed column through the rail's chip and timed out once the rail went
 * with it).
 */
export function railShown(args: { sideShown: boolean; nav: PanelNavStyle; rightSuppressed: boolean }): boolean {
  return args.sideShown && !args.rightSuppressed && args.nav === 'rail';
}
