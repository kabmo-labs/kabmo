/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The side-question prompt.
 *
 * Byte-for-byte omp's own `/btw` template
 * (`packages/coding-agent/src/prompts/system/btw-user.md`), including
 * "NEVER use tools": the side child runs with `--no-tools`, so a tool call is
 * impossible and the prompt must not invite one. Keeping the template identical
 * means a side question reads the same in both clients and a model tuned against
 * one behaves the same in the other.
 *
 * The parent session's history is NOT part of this text: the side session
 * resumes the parent's transcript, so the context arrives as real provider
 * messages and keeps the parent's prompt-cache prefix.
 */

export function buildBtwPrompt(question: string): string {
  return [
    '<btw>',
    'Ephemeral side question for current interactive session.',
    'Answer briefly, directly; use conversation context already provided.',
    'NEVER use tools.',
    'NEVER ask follow-up questions.',
    'Question:',
    question,
    '</btw>',
  ].join('\n');
}
