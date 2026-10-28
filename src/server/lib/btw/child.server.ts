/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Spawn arguments for a topic's side child.
 *
 * The side child is an ordinary `omp --mode rpc-ui` that resumes the topic's
 * transcript, run with `--no-tools`: a side question answers from the context it
 * already has and never executes a tool. That is omp's own rule — its TUI `/btw`
 * runs the side turn through `runEphemeralTurn`, which attaches the tool catalog
 * only to keep the prompt cache warm, tells the model in a system reminder that
 * tools are NOT available, and discards any tool call the model emits anyway
 * (`agent-session.ts`).
 *
 * `--no-tools` reaches the same end state from the CLI: the tool catalog is
 * omitted entirely, so a hallucinated call cannot execute and no approval gate
 * can park the turn. `--approval-mode` therefore has nothing to govern and is
 * not passed.
 *
 * `--no-title` stays: auto-titling would spend a model call on a transcript
 * nobody lists in the sidebar.
 */

import type { BtwModel } from '@/shared/types';

export interface BtwSpawnSettings {
  model?: BtwModel;
  /** Thinking level for the side child, or undefined for omp's own default. */
  thinkingLevel?: string;
}

export function buildBtwSpawnArgs(sessionFile: string, settings: BtwSpawnSettings): string[] {
  const args = ['--resume', sessionFile, '--no-title', '--no-tools'];
  if (settings.model) args.push('--model', `${settings.model.provider}/${settings.model.id}`);
  // 'auto' is a level omp accepts on the CLI (`CLI_THINKING_LEVELS`), so it is
  // passed through rather than dropped: the side child must classify its turns
  // the way the chat does when the chat is in auto mode.
  if (settings.thinkingLevel) args.push('--thinking', settings.thinkingLevel);
  return args;
}
