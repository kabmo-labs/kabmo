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
export function harnessForksAtMessage(harness: string | null | undefined): boolean {
  return harness === 'claude' || harness === 'codex';
}

/** The `_meta` both adapters read: `{version: 1, messageId}` under AIR. */
export function airForkPoint(messageId: string): Record<string, unknown> {
  return { jetbrains: { air: { fork: { version: 1, messageId } } } };
}
