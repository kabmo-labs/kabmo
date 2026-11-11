/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The capability set an agent advertised at `initialize`, plus the two facts
 * Kabmo derives from it.
 *
 * Rendered by the settings page, read by every panel's show/hide decision, and
 * cached per harness for the process lifetime — spawning seven agents on every
 * settings paint is the cost this exists to avoid.
 */

export interface HarnessCapabilities {
  /** Which config selectors the agent published, and how many values each has. */
  configModel: number;
  configThinking: number;
  configMode: number;
  /** Mode ids, so the composer knows whether `plan` is a real option. */
  modeValues: string[];
  loadSession: boolean;
  listSessions: boolean;
  forkSession: boolean;
  deleteSession: boolean;
  resumeSession: boolean;
  closeSession: boolean;
  /** `usage_update` was observed on this harness. Absent agents show
   *  "not reported" in the context and usage panels. */
  hasUsage: boolean;
  /** A `plan` update was observed. No measured agent sends one. */
  hasPlan: boolean;
  /** How mid-turn input works, or null when the agent has no way to take it. */
  steerMode: 'steer' | 'follow-up' | null;
  agentName?: string;
  agentVersion?: string;
  /** Why the harness is unusable, when it is: an auth method id, a missing
   *  binary, or the agent's own error text. */
  blocked?: string;
}

export const UNPROBED_CAPABILITIES: HarnessCapabilities = {
  configModel: 0,
  configThinking: 0,
  configMode: 0,
  modeValues: [],
  loadSession: false,
  listSessions: false,
  forkSession: false,
  deleteSession: false,
  resumeSession: false,
  closeSession: false,
  hasUsage: false,
  hasPlan: false,
  steerMode: null,
};

/** Spawn-time capability read: one ACP session, then dispose. */
export interface HarnessProbe {
  harness: string;
  capabilities: HarnessCapabilities;
  /** Model ids the agent would offer, in its own order. */
  models: { value: string; name: string }[];
  thinking: { value: string; name: string }[];
  modes: { value: string; name: string }[];
  /**
   * The mode the agent was in when it answered `session/new`, when it said.
   *
   * The composer's mode control on a chat that has not spawned yet has no live
   * session to ask, and `modes` alone says nothing about which one is current —
   * showing the first as current would be a guess the agent never made.
   */
  currentMode?: string;
  probedAt: number;
}
