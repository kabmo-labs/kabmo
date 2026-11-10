/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The session FACTS an ACP agent publishes about itself, parsed.
 *
 * These are the pieces of `session/update` that arrive BETWEEN turns —
 * `available_commands_update`, `usage_update` and `plan` — and they are the
 * reason the turn gate in `AcpSession.onNotification` cannot simply drop
 * everything while no turn is open: applying it to these made the composer's `/`
 * pool and the context panel describe a different agent entirely (measured: no
 * commands at all, and a context panel that never learned the agent reports
 * usage).
 *
 * Pure, and separate from the session, because each is a rule about ACP's wire
 * shape rather than about Kabmo's state: `parseAgentCommands` turns the
 * agent's own list into the shape the composer already reads, and
 * `metadataCapabilities` records what the agent's own frames PROVE it supports
 * instead of assuming a capability table.
 */

import type { HarnessCapabilities } from '@/server/lib/harness/capabilities';

/** One command an agent publishes, in Kabmo's command shape. */
export interface AgentCommand {
  name: string;
  description?: string;
  inputHint?: string;
}

/**
 * The agent's own `/` pool, from one `available_commands_update`.
 *
 * Entries without a usable name are dropped rather than rendered as a blank row,
 * and an absent `input.hint` stays absent: a command that takes no argument must
 * not claim to.
 */
export function parseAgentCommands(update: Record<string, unknown>): AgentCommand[] {
  const published = Array.isArray(update.availableCommands) ? update.availableCommands : [];
  return published.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const command = entry as Record<string, unknown>;
    const name = typeof command.name === 'string' ? command.name : '';
    if (!name) return [];
    const input = command.input && typeof command.input === 'object' ? command.input as Record<string, unknown> : undefined;
    const hint = typeof input?.hint === 'string' ? input.hint : undefined;
    return [{
      name,
      ...(typeof command.description === 'string' ? { description: command.description } : {}),
      ...(hint ? { inputHint: hint } : {}),
    }];
  });
}

/**
 * The capability flag a metadata frame PROVES, or the record unchanged.
 *
 * Returning the same object keeps an identity check meaningful at the call site,
 * and it is also the honest answer: a frame Kabmo does not recognise adds no
 * capability.
 */
export function metadataCapabilities(
  capabilities: HarnessCapabilities,
  kind: string,
): HarnessCapabilities {
  if (kind === 'usage_update') return { ...capabilities, hasUsage: true };
  if (kind === 'plan' || kind === 'plan_update') return { ...capabilities, hasPlan: true };
  return capabilities;
}
