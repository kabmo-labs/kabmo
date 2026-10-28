/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The one normalization every notice row's text goes through.
 *
 * Two paths produce the same row and they must agree, or a command's output
 * changes appearance when the page is refreshed: the live `command_output`
 * frame (`chat/omp/agent-events.ts`) and the custom entry a reload replays
 * (`omp/session/messages-map.ts`).
 *
 * What it removes, and why:
 *
 * - **ANSI escapes.** omp formats command output for a terminal — SGR colour
 *   runs and half-block progress bars. The notice card renders markdown through
 *   Shiki, which treats `\x1b[38;2;…m` as literal text, so `/context` drew 48
 *   escape bytes as `38;2;107;114;128m████…`. True colour stays available in the
 *   realtime xterm panel, which parses ANSI natively.
 * - **`<system-notice>` wrappers.** omp tags its own notices; the tag is
 *   scaffolding, not content. (The runtime-notice wrappers —
 *   `<system-reminder>`, `<system-interrupt>`, `<task-result>` — are NOT
 *   stripped: those identify the card variant `SystemNotice` renders, which
 *   strips them itself once it has read the tag.)
 */

import { stripAnsiCodes } from '@/shared/lib/code/ansi';

/** Strip terminal formatting and notice scaffolding, then trim. */
export function normalizeNoticeText(text: string): string {
  return stripAnsiCodes(text)
    .replace(/<\/?system-notice[^>]*>/g, '')
    .trim();
}
