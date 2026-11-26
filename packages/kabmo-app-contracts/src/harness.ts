/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The harness catalog as the CLIENT sees it: identities from the shared
 * catalog, capabilities from `/api/harness`.
 *
 * Split from `@kabmo-labs/kabmo-harness/catalog` because it is the wire shape, not
 * the identity: a panel reads `capabilities.hasUsage` to decide whether to draw
 * a number or say "not reported", and nothing in the client may invent one.
 */

import type { HarnessCapabilities } from '@kabmo-labs/kabmo-harness/launch/capabilities';
import type { HarnessConfig } from '@kabmo-labs/kabmo-harness/config';
import type { HarnessAccountView } from '@kabmo-labs/kabmo-harness/accounts';
import type { CanonicalProtocol } from '@kabmo-labs/kabmo-harness/provider/dialects';
import type { EnvProviderContract } from '@kabmo-labs/kabmo-harness/provider/provider-contracts';

export type { HarnessConfig };

export type { HarnessCapabilities };

/**
 * One selector value an ACP agent publishes (`configOptions[].options[]`), in
 * the agent's own order and its own words.
 *
 * The SAME shape is what a probe records and what a live session reports, so a
 * picker can list either without knowing which one it got.
 */
export interface HarnessSelectorValue {
  value: string;
  name: string;
}

/**
 * The model and thinking selectors a harness's LIVE chat published.
 *
 * A probe is one throwaway spawn: it can be refused (codex demands
 * authentication in the probe while the chat already running lists its models)
 * and its answer ages. When a session of that harness is open, these are the
 * selectors it published, and they are what the picker must show.
 */
export interface LiveHarnessModels {
  models: HarnessSelectorValue[];
  thinking?: HarnessSelectorValue[];
}

/** One row of `GET /api/harness`. */
export interface HarnessSummary {
  id: string;
  label: string;
  transport: 'rpc' | 'acp';
  canLaunch: boolean;
  /** True for the transport Kabmo itself provides (`omp-rpc`): there is nothing
   *  to install, probe or configure, so the settings page leaves it out and the
   *  picker never draws it as blocked. */
  builtIn?: true;
  /** True for a harness the user added, so the card can offer Remove. */
  custom?: true;
  /** The letter the UI draws when there is no vendor mark. */
  initial?: string;
  install?: string;
  /** The launch line this build ships for the agent, as typeable text. The
   *  config form's placeholder and hint must name THIS harness's line: the box
   *  used to advertise `agy acp` on the omp and Claude cards alike. */
  command?: string;
  note?: string;
  /** False when the user switched this harness off: it then leaves the settings
   *  menu and the composer's picker, so a roster of twelve becomes the agents
   *  someone actually runs. Always true for the built-in transport, which has no
   *  switch. */
  enabled: boolean;
  /** Whether the boot/refresh pass copies this agent's own sessions. On by the
   *  user's switch only: the pass spawns an agent per enabled harness. */
  autoImport?: boolean;
  /** The live probe, or null when this harness has never been probed. */
  probe: {
    harness: string;
    capabilities: HarnessCapabilities;
    models: HarnessSelectorValue[];
    thinking: HarnessSelectorValue[];
    modes: HarnessSelectorValue[];
    /** The mode the agent reported as current when its probe session opened,
     *  when it published one. */
    currentMode?: string;
    probedAt: number;
    /** True when the record is older than `PROBE_TTL_MS`. The answer is still
     *  shown — with its age — rather than being reported as "never probed". */
    stale?: true;
  } | null;
  unavailable?: string;
}

/** One provider as a registry holds it, minus its credential. */
export interface HarnessProviderRow {
  id: string;
  name: string;
  baseUrl?: string;
  /** The SOURCE's own dialect value, verbatim, for the row's footnote. */
  dialect?: string;
  /** That dialect on the shared vocabulary. Absent when Kabmo cannot name it. */
  protocol?: CanonicalProtocol;
  models: string[];
  /** Context window per model id, when the source declared one. */
  contextWindow?: Record<string, number>;
  /** The harness the entry came from — two sources can share an id. */
  source: string;
  hasKey: boolean;
}

/**
 * What one harness can do about OTHER providers, as `/api/harness` reports it.
 *
 * The level decides which SHAPE the settings card draws — a registry editor, an
 * env-var form, or a plain statement of the surface — and `importable` is the
 * credential-free list of entries a copy could take from elsewhere (a boolean
 * `hasKey`, never the key).
 */
export interface HarnessProviderSupport {
  level: 'full' | 'environment' | 'configurable' | 'none';
  file: string;
  fileLabel: string;
  summary: string;
  /** True when adding a provider ADDS a choice; false when it replaces the
   *  agent's own (Claude Code, Antigravity). */
  createsChoice: boolean;
  /** The env names this harness reads, for the `environment` form's labels. */
  env?: EnvProviderContract;
  /** The dot-path the providers live under in that file (`providers`,
   *  `model_providers`, `modelProviders`), so the card can name what it edits. */
  pointer?: string;
  /** The credential field's name in this format. `env_key`/`envKey` means a
   *  VARIABLE NAME, which the form says out loud. */
  credentialLabel?: string;
  /** The single protocol an `environment` harness's SDK speaks. */
  envProtocol?: CanonicalProtocol;
  /**
   * Every protocol this harness can carry, in the order an import prefers.
   *
   * Deliberately the TARGET's list, not a per-row verdict: whether a given
   * endpoint can land here is not knowable without asking it, and the import
   * does exactly that (`provider-probe.server.ts`). A row that declares a
   * different protocol is therefore still offered — the probe decides, and a
   * refusal names what the endpoint answered.
   */
  protocols: readonly CanonicalProtocol[];
  /** The CUSTOM providers this harness's own registry already holds. */
  configured: HarnessProviderRow[];
  importable: Array<{
    id: string;
    name: string;
    baseUrl?: string;
    /** The SOURCE's own dialect value, verbatim, for the row's footnote. */
    dialect?: string;
    /** That dialect on the shared vocabulary. Absent when Kabmo cannot name it. */
    protocol?: CanonicalProtocol;
    models: string[];
    /** Context window per model id, when the source declared one. */
    contextWindow?: Record<string, number>;
    /** The harness the entry came from — two sources can share an id. */
    source: string;
    hasKey: boolean;
  }>;
}

/**
 * What an import did, as the card repeats it.
 *
 * `problem` is the refusal (already a sentence a reader can act on); `detail`
 * is the evidence for a SUCCESS — the protocol that landed, where it was written,
 * and the env lines a variable-name format needed. Two fields because "copied"
 * alone was a claim: measured imports differ in the protocol they chose, and a
 * reader has to be able to check that.
 */
export interface HarnessImportOutcome {
  problem: string | null;
  detail: string | null;
}

export interface HarnessesPayload {
  harnesses: HarnessSummary[];
  /** Per-harness config, keyed by id. Absent from an answer written before this
   *  field existed, so every reader treats it as optional. */
  configs?: Record<string, HarnessConfig>;
  /** Per-harness provider support, keyed by id. */
  providerSupport?: Record<string, HarnessProviderSupport>;
  /** Saved CLI homes for Codex, Claude and Antigravity. */
  accounts?: HarnessAccountView[];
  /** harness id -> selected account id; null means the host login. */
  accountSelection?: Record<string, string | null>;
}

/** Capabilities for a harness the client has no row for: nothing is claimed, so
 *  every panel falls back to its "not reported" state rather than guessing. */
export const UNKNOWN_CAPABILITIES: HarnessCapabilities = {
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

/** The capabilities of a harness from a payload, or the empty set. */
export function capabilitiesOf(
  harnesses: readonly HarnessSummary[],
  id: string | null | undefined,
): HarnessCapabilities {
  if (!id) return UNKNOWN_CAPABILITIES;
  return harnesses.find((entry) => entry.id === id)?.probe?.capabilities ?? UNKNOWN_CAPABILITIES;
}

/**
 * What one `session/list` import did, in words the card can repeat.
 *
 * `outside` is not a failure: the agent holds sessions whose cwd is not a
 * workspace Kabmo knows, so the sidebar has no folder to file them under. The
 * count exists so a reader can tell "nothing found" from "found, but elsewhere".
 *
 * `empty` is the same kind of answer for a session the agent created and never
 * used: its own store holds no transcript, so the sidebar would draw a row that
 * opens an empty chat. It is skipped, and counted rather than hidden.
 *
 * `deleted` is the tombstone: a chat the user deleted stays deleted even though
 * the agent's store still lists it.
 */
export interface HarnessSessionImport {
  harness: string;
  imported: number;
  known: number;
  outside: number;
  empty: number;
  deleted: number;
}
