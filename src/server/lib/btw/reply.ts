/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The side reply's stored summary, bounded the way omp bounds its own.
 *
 * omp runs every ephemeral side reply through `dedupeEphemeralReply`
 * (`session/messages.ts`): a run of more than three identical lines collapses to
 * one line plus `[…N×]`, and the whole reply is capped at 4 KiB with a
 * `[…truncated]` suffix. The cap exists because a degenerate model can emit
 * thousands of identical lines, and this summary is what the panel's history
 * labels and a promotion's title are built from.
 *
 * Only the turn's `answer` summary goes through here. The rendered conversation
 * (`messages`) is stored whole — truncating that would hide content the panel is
 * there to show.
 */

/** Longest stored summary, matching omp's `EPHEMERAL_REPLY_MAX_BYTES`. */
const MAX_REPLY_BYTES = 4096;

/** Runs longer than this collapse to one line plus a count. */
const MAX_REPEATED_LINES = 3;

export function boundSideReply(text: string): string {
  if (!text) return text;
  const lines = text.split('\n');
  const collapsed: string[] = [];
  let index = 0;
  while (index < lines.length) {
    let next = index + 1;
    while (next < lines.length && lines[next] === lines[index]) next += 1;
    const runLength = next - index;
    if (runLength > MAX_REPEATED_LINES) {
      collapsed.push(lines[index], `[…${runLength}×]`);
    } else {
      for (let repeat = 0; repeat < runLength; repeat += 1) collapsed.push(lines[index]);
    }
    index = next;
  }
  let result = collapsed.join('\n');
  if (Buffer.byteLength(result, 'utf8') <= MAX_REPLY_BYTES) return result;
  const suffix = '\n[…truncated]';
  const budget = MAX_REPLY_BYTES - Buffer.byteLength(suffix, 'utf8');
  // Cut by code point: slicing at an arbitrary byte would leave half a surrogate
  // pair, which JSON-serializes as U+FFFD and never round-trips.
  while (result.length > 0 && Buffer.byteLength(result, 'utf8') > budget) {
    const last = result.charCodeAt(result.length - 1);
    result = result.slice(0, last >= 0xdc00 && last <= 0xdfff ? -2 : -1);
  }
  return result + suffix;
}
