/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The ACP session-mode selector, as the composer reads it.
 *
 * ACP exposes modes as a `mode`-category config option; this is the normalized
 * shape the `/modes` route answers and the dropdown renders. It is shared so
 * the server route, the client hook and the component agree on one spelling.
 */

export interface SessionModeChoice {
  value: string;
  name: string;
}

export interface SessionModeState {
  /** The agent's current mode id. */
  currentValue: string;
  /** Every advertised value, in the agent's order. */
  values: SessionModeChoice[];
}
