/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `useHarnesses()` contract, named where a consumer can import it.
 *
 * The store's implementation file is at the 350-line ceiling; the type earns its
 * own module and keeps every consumer off `ReturnType<typeof useHarnesses>`.
 */

import type {
  HarnessConfig, HarnessImportOutcome, HarnessProviderSupport, HarnessSummary, LiveHarnessModels,
} from '@/shared/types/harness';
import type { AddProviderInput } from '@/client/components/settings/categories/harness-settings/AddProviderForm';

export interface HarnessesController {
  harnesses: HarnessSummary[];
  /** Per-harness config, keyed by id. Empty until the catalog is read. */
  configs: Record<string, HarnessConfig>;
  /** Persist one harness's config; resolves to the server's refusal, or null. */
  saveConfig: (id: string, config: HarnessConfig) => Promise<string | null>;
  /** What each harness can do about other providers, keyed by id. */
  providerSupport: Record<string, HarnessProviderSupport>;
  /**
   * The model/thinking selectors a harness's LIVE chat published, keyed by id.
   *
   * A probe is one throwaway spawn, and it can be refused (`codex` answers
   * "Authentication required" to the probe while the chat the user is running
   * lists its models) or aged. The open session's own selectors are the truth
   * for that harness, so the picker reads them first; absent means "only the
   * probe has spoken".
   */
  liveModels: Record<string, LiveHarnessModels>;
  /** Copy one provider from a source registry into a harness.
   *
   *  The ROW travels with the id: the writer needs the endpoint, dialect and
   *  model list, and the server would otherwise have to look them up again. The
   *  credential is not in the row — the server reads that from the source file. */
  importProvider: (
    id: string,
    sourceId: string,
    entry: HarnessProviderSupport['importable'][number],
  ) => Promise<HarnessImportOutcome>;
  /** Add a provider by typing its endpoint and key. */
  addProvider: (id: string, input: AddProviderInput) => Promise<HarnessImportOutcome>;
  isLoading: boolean;
  error: string | null;
  /** Re-read the catalog. */
  reload: () => void;
  /** Probe one harness (spawns that agent once) and merge the answer in. */
  probe: (id: string, cwd?: string) => Promise<string | null>;
  /** Switch one harness on or off. Switching ON also probes it once, server-side,
   *  so its models are ready for the composer. Resolves to the refusal, or null. */
  setEnabled: (id: string, enabled: boolean) => Promise<string | null>;
}
