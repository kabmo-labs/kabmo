/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The commit-message prompt, and the reader that turns a model's reply back
 * into a message.
 *
 * The template lives in `shared/lib/git/commit-prompt.ts` because the settings
 * page edits the same text. This module only fills it from a `CommitContext`
 * and cleans the answer.
 *
 * The scope line is deliberate. A model that is handed a diff will describe
 * everything it can see; if the prompt does not say this is the STAGED set, a
 * message can mention work that is not in the commit.
 */

import {
  DEFAULT_COMMIT_MESSAGE_PROMPT,
  renderCommitPrompt,
} from '@/shared/lib/git/commit-prompt';
import type { CommitContext } from '@/server/lib/fs/git-commit-context';

export function buildCommitMessagePrompt(context: CommitContext, template = ''): string {
  const files = context.files.length > 0
    ? context.files.map((file) => `- ${file}`).join('\n')
    : '(no files listed)';
  const recent = context.recentCommits.length > 0
    ? context.recentCommits.map((subject) => `- ${subject}`).join('\n')
    : '(no commits yet)';
  const scope = context.amend
    ? 'the commit being amended'
    : 'the staged change set';

  return renderCommitPrompt(template.trim() || DEFAULT_COMMIT_MESSAGE_PROMPT, {
    scope,
    branch: context.branch,
    recent_commits: recent,
    files,
    diff: context.diff || '(no textual diff)',
    truncated: context.truncated
      ? 'The diff was truncated to fit the model context; describe only what is visible.'
      : '',
  }).trim();
}

/**
 * A reply as a commit message: code fences and a leading "Commit message:"
 * label are the two wrappers models add despite being told not to.
 */
export function cleanCommitMessage(text: string): string {
  let value = text.trim();
  const fenced = /^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n```$/.exec(value);
  if (fenced) value = fenced[1].trim();
  return value.replace(/^(?:commit message|message)\s*:\s*/i, '').trim();
}
