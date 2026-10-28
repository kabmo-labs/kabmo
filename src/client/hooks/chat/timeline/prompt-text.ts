/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Prompt assembly for Kabmo composer: rewrite composer-level mentions
 * into what oh-my-pi actually receives, then inline the text attachments the
 * user dropped in. Extracted from the send path so that hook stays under the
 * repo's per-file size ceiling.
 */

import { composeMessageWithTextAttachments } from '@/shared/lib/chat/attachments';
import { loadAgentNames } from '@/shared/lib/chat/composer/client';
import { translateAgentMentions, translateFileMentions } from '@/shared/lib/chat/composer/translate';

type TextFileAttachment = Parameters<typeof composeMessageWithTextAttachments>[1][number];

/**
 * Build the outgoing prompt. `@agent` mentions are rewritten into an explicit
 * task-tool delegation directive at send time (oh-my-pi has no `@agent`
 * syntax); translation failures fall back to the raw prompt.
 *
 * A file whose bytes could not be read is left OUT rather than inlined empty:
 * an empty fenced block tells the model the file exists and says nothing, which
 * is worse than not mentioning it. The composer reports the omission.
 */
export async function buildPromptText(text: string, textFiles: TextFileAttachment[]): Promise<string> {
  const readable = textFiles.filter((file) => !('missing' in file && file.missing));
  let translated = text;
  try {
    const names = await loadAgentNames();
    if (names.length > 0) translated = translateAgentMentions(text, names).text;
  } catch {
    // keep the raw prompt
  }
  // File mentions are namespaced (`@file:`) by the picker; strip the namespace
  // only after the agent pass so `@file:<name>` is never mistaken for `@agent`.
  return composeMessageWithTextAttachments(translateFileMentions(translated), readable);
}
