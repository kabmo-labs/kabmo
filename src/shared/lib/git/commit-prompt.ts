/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The commit-message prompt as DATA: the built-in template, the placeholders it
 * fills, and the one rule a custom template must keep.
 *
 * Shared because the settings page shows the same text the server sends. A
 * second copy in the client is how the editor would offer a prompt the server
 * does not use, or a reset button would restore text that is not the default.
 *
 * `{{diff}}` is REQUIRED. Orca's #20112 is the failure this prevents: a saved
 * template that referenced none of the staged context silently generated the
 * same message in every repository, because the model was asked to describe the
 * template's own example. A prompt without the diff is refused, not run.
 */

export const COMMIT_PROMPT_PLACEHOLDERS = [
  { key: 'scope', description: '“the staged change set”, or “the commit being amended”.' },
  { key: 'branch', description: 'The current branch name.' },
  { key: 'recent_commits', description: 'The last ten subjects, newest first.' },
  { key: 'files', description: 'The files in this commit.' },
  { key: 'diff', description: 'The staged patch. Required.' },
  { key: 'truncated', description: 'A note when the diff was cut to fit the model.' },
] as const;

export type CommitPromptKey = (typeof COMMIT_PROMPT_PLACEHOLDERS)[number]['key'];

export type CommitPromptValues = Record<CommitPromptKey, string>;

export const DEFAULT_COMMIT_MESSAGE_PROMPT = `You write git commit messages. Return only the commit message, no prose, no code fences.

The diff below is {{scope}} — exactly what this commit will contain. Do not describe unstaged or untracked changes; they are not part of this commit.

Follow the repository's existing style from the recent commits: language, capitalization, type prefix/scope, and typical length. If the recent commits are inconsistent, use Conventional Commits: <type>: <summary> with feat|fix|refactor|perf|docs|test|build|ci|chore|style|revert.

Subject: imperative, <= 72 characters, no trailing period. Body: only when it adds useful information, wrapped at 72 characters, separated from the subject by a blank line.

Branch: {{branch}}

Recent commits (newest first):
{{recent_commits}}

Files in this commit:
{{files}}

Diff:
{{diff}}

{{truncated}}

Return only the commit message.`;

/** Fill a template's placeholders. An unknown `{{name}}` is left verbatim, so
 *  a typo is visible in the prompt rather than silently becoming empty. */
export function renderCommitPrompt(template: string, values: CommitPromptValues): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (match, key: string) => (
    key in values ? values[key as CommitPromptKey] : match
  ));
}

export function validateCommitPrompt(template: string): { ok: true } | { ok: false; error: string } {
  if (!/\{\{\s*diff\s*\}\}/.test(template)) {
    return {
      ok: false,
      error: 'The prompt must include {{diff}} so the model sees the staged changes.',
    };
  }
  return { ok: true };
}
