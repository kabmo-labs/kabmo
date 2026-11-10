/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which mode toggles a harness can actually honour.
 *
 * Pure, so the rule is testable without a render. Split from `modes.ts` when
 * the compositor's ACP mode selector pushed that hook toward the file ceiling.
 *
 * Goal is available on every harness: Kabmo owns the record and the loop for
 * ACP (`acp-goal.server.ts`), and omp carries the extension. Plan is different —
 * it must be a real mode the agent publishes (`claude` does, `opencode` does
 * not), except on omp's own two transports, which always expose the Plan
 * toggle. An unknown harness keeps the old surface: the row may simply not have
 * arrived yet.
 */

export interface ModeCapabilities {
  /** The harness that owns this chat, when the tab knows it. */
  harness?: string | null;
  /** The harness's own `mode` values, from its probe: `plan` is a real mode on
   *  the agents that publish one. */
  modeValues?: string[];
}

export function modeAvailability(capabilities: ModeCapabilities): { plan: boolean; goal: boolean } {
  if (capabilities.harness === 'omp-rpc') return { plan: true, goal: true };
  if (!capabilities.harness) return { plan: true, goal: true };
  if (capabilities.harness === 'omp-acp') return { plan: true, goal: true };
  return { plan: capabilities.modeValues?.includes('plan') === true, goal: true };
}
