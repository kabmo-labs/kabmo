/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The harness catalog as the CLIENT sees it: identities from the shared
 * catalog, capabilities from `/api/harness`.
 *
 * Split from `@/shared/lib/harness/catalog` because it is the wire shape, not
 * the identity: a panel reads `capabilities.hasUsage` to decide whether to draw
 * a number or say "not reported", and nothing in the client may invent one.
 */

import type { HarnessCapabilities } from '@/server/lib/harness/capabilities';
import type { HarnessConfig } from '@/shared/lib/harness/config';

export type { HarnessConfig };

export type { HarnessCapabilities };

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
  install?: string;
  note?: string;
  /** The live probe, or null when this harness has never been probed. */
  probe: {
    harness: string;
    capabilities: HarnessCapabilities;
    models: { value: string; name: string }[];
    thinking: { value: string; name: string }[];
    modes: { value: string; name: string }[];
    probedAt: number;
  } | null;
  unavailable?: string;
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
  env?: { baseUrl: string; apiKey: string; model?: string };
  /** The dot-path the providers live under in that file (`providers`,
   *  `model_providers`, `modelProviders`), so the card can name what it edits. */
  pointer?: string;
  /** The credential field's name in this format. `env_key`/`envKey` means a
   *  VARIABLE NAME, which the form says out loud. */
  credentialLabel?: string;
  importable: Array<{
    id: string;
    name: string;
    baseUrl?: string;
    dialect?: string;
    models: string[];
    /** The harness the entry came from — two sources can share an id. */
    source: string;
    hasKey: boolean;
  }>;
}

export interface HarnessesPayload {
  harnesses: HarnessSummary[];
  /** Per-harness config, keyed by id. Absent from an answer written before this
   *  field existed, so every reader treats it as optional. */
  configs?: Record<string, HarnessConfig>;
  /** Per-harness provider support, keyed by id. */
  providerSupport?: Record<string, HarnessProviderSupport>;
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
