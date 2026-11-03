/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The thinking levels an omp agent definition can pin.
 *
 * Mirrors `CLI_THINKING_LEVELS` in `@oh-my-pi/pi-tui` 18.16.0 — the selectors
 * omp itself accepts and writes. A free-text field here invited `"medium "` or
 * `"thinking"`, both of which `parseConfiguredThinkingLevel` drops, so the agent
 * silently ran at the session's level with a value on screen saying otherwise.
 */

import type { AgentItem } from '@/shared/types';

/** `off` and the effort ladder, then `auto`. The first entry is "inherit". */
export const AGENT_THINKING_LEVELS = [
  'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'auto',
] as const;

export type AgentThinkingLevel = (typeof AGENT_THINKING_LEVELS)[number];

/** What a row's `null` means: the agent does not pin a level. */
export const AGENT_THINKING_DEFAULT = '';

/** A definition the pane can edit, or the empty template a create starts from. */
export function emptyAgentTemplate(): AgentItem {
  return {
    id: 'new-agent',
    name: 'new-agent',
    description: '',
    scope: 'user',
    thinkingLevel: AGENT_THINKING_DEFAULT,
    systemPrompt: '',
    isBuiltIn: false,
  };
}
