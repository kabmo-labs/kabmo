/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Prompt assembly for Kabmo composer: rewrite composer-level mentions into what
 * the agent actually receives, then inline the text attachments the user
 * dropped in. Extracted from the send path so that hook stays under the repo's
 * per-file size ceiling.
 */

import { composeMessageWithTextAttachments } from '@/shared/lib/chat/attachments';
import { loadAgentNames } from '@/shared/lib/chat/composer/client';
import {
  delegationErrorText,
  formatDelegationPrompt,
  parseHarnessMentions,
} from '@/shared/lib/chat/composer/delegation';
import { translateAgentMentions, translateFileMentions } from '@/shared/lib/chat/composer/translate';

type TextFileAttachment = Parameters<typeof composeMessageWithTextAttachments>[1][number];

/** A mention the composer cannot send, with the sentence the user needs. */
export class DelegationPromptError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'DelegationPromptError';
  }
}

/**
 * Build the outgoing prompt.
 *
 * `@harness` mentions are compiled into an orchestrator contract plus one exact
 * `kabmo session spawn` command per worker; the paragraph's own words become
 * that worker's TASK. A bare `@claude` carries no model, so the spawn uses the
 * harness's configured default (or the agent's own).
 *
 * `@agent` mentions are omp's subagent syntax and are rewritten only for the
 * harnesses that have it. A file whose bytes could not be read is left OUT
 * rather than inlined empty: an empty fenced block tells the model the file
 * exists and says nothing, which is worse than not mentioning it.
 */
export async function buildPromptText(
  text: string,
  textFiles: TextFileAttachment[],
  options: { includeAgents?: boolean } = {},
): Promise<string> {
  const readable = textFiles.filter((file) => !('missing' in file && file.missing));
  const names = options.includeAgents === false
    ? []
    : await loadAgentNames().catch(() => []);
  const plan = parseHarnessMentions(text, { agentNames: names });
  const refusal = delegationErrorText(plan);
  if (refusal) throw new DelegationPromptError(refusal);

  let translated: string;
  if (plan.delegations.length > 0) {
    // The orchestrator's own paragraphs still get omp's agent rewrite; a
    // worker task does not, because that text is read by a different harness
    // and `task` is not its vocabulary.
    if (options.includeAgents !== false && names.length > 0) {
      plan.orchestratorText = translateAgentMentions(plan.orchestratorText, names).text;
    }
    translated = formatDelegationPrompt(plan);
  } else {
    translated = text;
    if (options.includeAgents !== false && names.length > 0) {
      translated = translateAgentMentions(translated, names).text;
    }
  }
  // File mentions are namespaced (`@file:`) by the picker; strip the namespace
  // only after the agent pass so `@file:<name>` is never mistaken for `@agent`.
  return composeMessageWithTextAttachments(translateFileMentions(translated), readable);
}
