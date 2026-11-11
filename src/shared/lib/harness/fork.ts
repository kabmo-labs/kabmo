/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which ACP harnesses accept a fork POINT (a message id) on `session/fork`.
 *
 * Standard ACP has no anchor — the session-fork RFD lists a message id as a
 * future extension. The JetBrains-maintained adapters implement it today as the
 * AIR extension `_meta.jetbrains.air.fork`: claude-agent-acp forks at an
 * assistant message, codex-acp at the turn that holds the message. Every other
 * adapter ignores the key and forks the whole session, so an anchor there is
 * refused instead of being answered with the tip.
 */

import { harnessHasLocalTranscript } from '@/shared/lib/harness/transcript';

export function harnessForksAtMessage(harness: string | null | undefined): boolean {
  return harness === 'claude' || harness === 'codex';
}

/**
 * Harnesses that advertise `session/fork` but take no anchor: the fork copies
 * the whole conversation. `zcode` is checkpoint-scoped (`latestCheckpoint`),
 * `opencode` and `minimax` have a message-level fork in their own API that
 * their ACP adapter does not pass through.
 */
export function harnessForksWholeChat(harness: string | null | undefined): boolean {
  return harness === 'opencode' || harness === 'minimax' || harness === 'zcode';
}

/** What a harness can fork: nothing, the whole chat, or at a message. */
export type ForkCapability = 'none' | 'tip' | 'message';

export function forkCapability(harness: string | null | undefined): ForkCapability {
  if (harnessHasLocalTranscript(harness)) return 'message';
  if (harnessForksAtMessage(harness)) return 'message';
  if (harnessForksWholeChat(harness)) return 'tip';
  return 'none';
}

/**
 * Whether a whole-chat fork is offered. The probe is authoritative when it has
 * an answer (an agent that does not advertise `session/fork` must not get the
 * action); without one, the harness's expected capability decides.
 */
export function canForkChat(
  harness: string | null | undefined,
  probeFork?: boolean | null,
): boolean {
  if (probeFork === true) return true;
  if (probeFork === false) return false;
  return forkCapability(harness) !== 'none';
}

/** The `_meta` both AIR adapters read: `{version: 1, messageId}` under AIR. */
export function airForkPoint(messageId: string): Record<string, unknown> {
  return { jetbrains: { air: { fork: { version: 1, messageId } } } };
}
