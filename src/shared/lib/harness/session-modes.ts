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

/** What a harness probe knows about an agent's own mode ladder. */
export interface ProbedSessionModes {
  choices: readonly SessionModeChoice[];
  /** The value the agent was in when it answered `session/new`, when it said. */
  current?: string;
}

/**
 * The selector a chat with NO live session can offer, built from its harness's
 * probe — so the composer switches to the picked agent's own modes the moment
 * the harness is chosen, instead of only after the first prompt spawned.
 *
 * `picked` is the operator's own choice and wins over the probe's. When neither
 * is known `currentValue` is empty: the agent starts on its own default, and
 * drawing the first advertised value as "current" would claim a selection the
 * agent never made.
 */
export function pendingSessionMode(
  probe: ProbedSessionModes | undefined,
  picked: string | null,
): SessionModeState | null {
  const choices = probe?.choices ?? [];
  if (choices.length === 0) return null;
  const offered = (value: string | null | undefined): string =>
    value && choices.some((choice) => choice.value === value) ? value : '';
  return {
    currentValue: offered(picked) || offered(probe?.current),
    values: choices.map((choice) => ({ ...choice })),
  };
}
