/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The horizontal frame inset of a transcript block — a tool card, a thinking
 * accordion, a system notice, a user bubble.
 *
 * Desktop keeps `mx-3`: the timeline's own container is `p-4`, and the extra
 * 12px is what gives a card the same optical margin as the prose beside it.
 *
 * A phone does NOT. Its timeline container is already `px-3`, and that is the
 * same 12px the composer dock uses — so a block that added another `mx-3` put
 * every card 12px inside the composer's own edge, and the transcript read as
 * two columns that never met. On mobile the block's frame IS the gutter.
 *
 * Stated once, because the class was written out at four separate call sites
 * and a missed one is a card sitting 12px off its neighbours.
 */
export function transcriptGutter(isMobile: boolean): string {
  return isMobile ? '' : 'mx-3';
}

/**
 * Padding INSIDE a framed transcript block (the user bubble, the provider
 * error strip).
 *
 * The pair with `transcriptGutter` is what keeps a phone's text column on one
 * line: 12px frame + 12px padding = 24, which is exactly where the prose rows
 * (`px-3` inside the same container) and the composer's textarea already sit.
 * Desktop keeps its roomier `p-3.5`, because there the frame is inset and the
 * text column is not shared with an edge-to-edge composer.
 */
export function transcriptBlockPadding(isMobile: boolean): string {
  return isMobile ? 'p-3' : 'p-3.5';
}
