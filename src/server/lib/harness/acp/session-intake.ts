/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What reaches an ACP agent as a PROMPT: a turn, a steer, or a held input.
 *
 * Split out of `session.ts` for the per-file ceiling, and because the rules here
 * are one subject: a prompt is content blocks built from the composer's text,
 * images and `@path` mentions, a turn is refused when the agent cannot accept
 * the images, and an agent with no mid-turn channel gets the message queued
 * instead of an error.
 */

import { promptBlocks } from '@/server/lib/harness/acp/prompt';
import { promptFileLinks } from '@/server/lib/harness/acp/prompt-files';

/** The session slice a prompt needs. `AcpSession` satisfies it as-is. */
export interface AcpPromptHost {
  readonly cwd: string;
  readonly harness: string;
  readonly acceptsImages: boolean;
  /** `promptCapabilities.embeddedContext`; false is an explicit refusal. */
  readonly acceptsEmbeddedContext?: boolean;
  promptCount: number;
  background: { stop(): void };
  usage: { beginTurn(): void };
  /** Open the turn; `beginAcpTurn` owns the counts and the run marker. */
  beginTurn(message: string, images: unknown): unknown;
  emit(event: Record<string, unknown> & { type: string }): void;
  /** The agent's own mid-turn verb, when it advertised `_meta.steering`. */
  steer(blocks: unknown[], queue: 'steering' | 'followUp'): Promise<unknown>;
  /** Hold the input for the next turn. */
  queueTurnInput(message: string, images: unknown): void;
}

/** The blocks one prompt sends, so a steer carries the same file links. */
export function promptContent(
  host: { cwd: string; acceptsEmbeddedContext?: boolean },
  message: string,
  images: unknown,
): Promise<unknown[]> {
  return promptFileLinks(host.cwd, message).then((files) =>
    promptBlocks(message, images, files, { embeddedContext: host.acceptsEmbeddedContext }));
}

/** Run one turn. Refuses images the agent never advertised.
 *
 *  `quiet` is for a prompt Kabmo sends itself (the background pull): it must
 *  open a turn and start the agent, but it is not a user turn, so it draws no
 *  user row and is not recorded as one. */
export function startAcpPrompt(
  host: AcpPromptHost,
  message: string,
  images: unknown,
  options: { quiet?: boolean } = {},
): unknown {
  // ACP's prompt capabilities are a MUST: an agent that did not advertise
  // `image` has to be told, not sent blocks its dispatcher rejects.
  if (!host.acceptsImages && Array.isArray(images) && images.length > 0) {
    throw new Error(`This harness does not accept image attachments (${host.harness})`);
  }
  // A new prompt is the next request, so the agent flushes any held update
  // itself; a probe would duplicate it.
  host.background.stop();
  host.promptCount += 1;
  host.usage.beginTurn();
  const ack = host.beginTurn(message, images);
  // Only a delivered turn is recorded: a refusal must not leave a user row.
  if (options.quiet !== true) host.emit({ type: 'user_turn', message, images });
  return ack;
}

/** One mid-turn message: steer when the agent can, queue when it cannot. */
export async function sendAcpMidTurn(
  host: AcpPromptHost,
  queue: 'steering' | 'followUp',
  message: string,
  images: unknown,
  canSteer: boolean,
): Promise<unknown> {
  if (!canSteer) {
    host.queueTurnInput(message, images);
    host.emit({ type: 'user_turn', message, images });
    return { queued: true };
  }
  const result = await host.steer(await promptContent(host, message, images), queue);
  host.emit({ type: 'user_turn', message, images });
  return result;
}
