/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The two verdicts a CLOSED assistant message supplies when a turn ends, split
 * out of `turn.ts` so that file stays inside the size ceiling.
 *
 * Both are about what the agent actually sent, not about the envelope's
 * `stopReason`: an agent records the provider's failure on the message, and a
 * message whose blocks render nothing is the same operator-visible failure as no
 * message at all.
 */

import { deriveTurnError } from '@kabmo-labs/kabmo-omp-session-parse/turn-error';

/**
 * The reason the CLOSED message names, when it named one.
 *
 * The same rule as omp's: an agent records `stopReason` / `errorMessage` flat on
 * the assistant message, and reading only the envelope's stop reason threw the
 * provider's own words away — a coordinator was told "the agent ended the turn
 * with an error" over a transcript that said which.
 */
export function closedFailure(message: unknown): string | null {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
  const error = deriveTurnError(message as Record<string, unknown>);
  return error?.message?.trim() || null;
}

/** Does the closed message carry anything the timeline draws? A whitespace-only
 *  chunk (or one that carried only an empty text block) opens a message row
 *  that renders nothing, which is the same operator-visible failure as no frame
 *  at all. Thinking and tool calls are content: they render as their own
 *  blocks. */
export function hasRenderableAnswer(message: unknown): boolean {
  if (!message || typeof message !== 'object' || !('content' in message)) return false;
  const content = message.content;
  if (!Array.isArray(content)) return false;
  return content.some((block) => {
    if (!block || typeof block !== 'object') return false;
    if ('text' in block && typeof block.text === 'string') return block.text.trim().length > 0;
    if ('thinking' in block && typeof block.thinking === 'string') return block.thinking.trim().length > 0;
    return 'type' in block && block.type === 'toolCall';
  });
}

/** What one finished turn reports as its outcome. */
export interface TurnVerdict {
  failed: boolean;
  cancelled: boolean;
  reason: string | null;
}

/** The verdict for a closed turn.
 *
 *  A prompt that ends with no message and no tool call is a SILENT failure on
 *  most agents (measured on pi-acp: it answers `session/prompt` with `{}` and
 *  sends no frames when its provider call fails). Whitespace-only chunks are the
 *  same failure with a frame attached. Slash commands are exempt — an extension
 *  command is answered locally and correctly produces nothing — and a user's Stop
 *  is not a failure either.
 *
 *  `stopReason: 'error'` is a failure even when the agent DID send a partial
 *  message: a v1 agent answers `{stopReason:'error'}` with whatever it streamed,
 *  and reading only "did it answer" told a coordinator its failed worker had
 *  finished. v2 cannot infer failure from an idle without a stop reason, so the
 *  silent-turn rule is gated to `completion === 'response'`. */
export function turnVerdict(args: {
  closed: unknown;
  abandoned: number;
  result: { stopReason?: string } | undefined;
  reported: boolean;
  stranded: boolean;
  /** The prompt text, to exempt slash commands. */
  promptText: string;
  completion: 'response' | 'state';
  strandedReason: string;
  /** A reason the caller already knows and reported. */
  failure?: string;
}): TurnVerdict {
  const answered = hasRenderableAnswer(args.closed) || args.abandoned > 0;
  const cancelled = args.result?.stopReason === 'cancelled';
  const slash = args.promptText.trimStart().startsWith('/');
  const failed = !cancelled && !slash
    && (args.stranded || args.reported || args.result?.stopReason === 'error' || (args.completion === 'response' && !answered));
  const reason = failed
    ? (args.failure ?? (args.stranded
      ? args.strandedReason
      : closedFailure(args.closed) ?? (args.result?.stopReason === 'error'
        ? 'The agent ended the turn with an error'
        : 'The agent ended the turn without sending an answer')))
    : null;
  return { failed, cancelled, reason };
}

/** A slash command is answered locally and correctly produces nothing, so the
 *  silent-turn verdict never applies to one. */
export function reasonSuppressed(promptText: string): boolean {
  return promptText.trimStart().startsWith('/');
}
