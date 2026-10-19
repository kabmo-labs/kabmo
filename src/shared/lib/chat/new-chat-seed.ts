/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The draft the New Chat modal opens with.
 *
 * A chat branched from a row is seeded with that row's text, and the user then
 * types their own instruction underneath. Without a boundary the two run
 * together in one paragraph: neither the user nor the model can tell where the
 * quoted message ended and the new instruction began.
 *
 * The divider is a thematic break, and the BLANK LINE before it is load-bearing:
 * a `---` placed directly under a line of text is a setext H2 underline, which
 * would turn the seeded message into a heading wherever the prompt is rendered
 * as markdown (the timeline renders every user turn). With the blank line it is
 * a horizontal rule, which is inert.
 *
 * It sits AFTER the seed on purpose. The divider must not touch a leading
 * `/command` — omp parses the command token at the START of the prompt, and a
 * builtin such as `/usage` is a legitimate thing to branch a chat from. It is
 * deliberately not a code fence either: fencing the seed would turn that command
 * into prose, and it would not hide anything, because nothing in this path
 * executes the text on Kabmo's side.
 */

/** The line that separates the seeded message from the user's own addition. */
export const NEW_CHAT_SEED_DIVIDER = '---';

/** Seed a New Chat draft: the quoted message, a divider, then room to type. */
export function seedNewChatDraft(seed: string): string {
  const text = seed.trim();
  if (!text) return '';
  return `${text}\n\n${NEW_CHAT_SEED_DIVIDER}\n`;
}
