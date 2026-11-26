/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/** One frame from a harness agent's event stream. */
export interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

export type EventListener = (event: AgentEvent) => void;
