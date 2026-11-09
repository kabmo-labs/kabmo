/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The two ways a provider gets INTO a harness, from the browser's side.
 *
 * They are one module because they are one problem: the route funnels both
 * through `applyProvider`, and the evidence they answer with is the SAME shape —
 * so a single formatter turns either into what the card repeats. Two copies would
 * drift the moment one learned a new note, and the reader would see two different
 * accounts of the same kind of write.
 *
 * The credential rule differs, and that difference is the module's whole point:
 *
 *  - an **import** never carries a key — the route reads it from the SOURCE file
 *    inside the request that writes, so no browser tab ever holds it;
 *  - an **add** does, because it was typed here and exists nowhere else.
 *
 * Either way the caller supplies `announce`, which folds the server's answer back
 * into the shared harness store: the write landed in a FILE, so the list has to be
 * re-read for the card to show it.
 */

import type { HarnessConfig, HarnessImportOutcome, HarnessProviderSupport } from '@/shared/types/harness';
import type { AddProviderInput } from '@/client/components/settings/categories/harness-settings/AddProviderForm';

/** The answer both provider writes share. */
interface ProviderWritePayload {
  imported?: { id: string; replaced: boolean; path: string; dialect: string; notes: string[] };
  config?: HarnessConfig;
  envWritten?: string[];
  target?: string;
  protocol?: string;
  probe?: { protocols: string[]; error?: string };
  /** Harness tabs whose cached probe no longer describes the registry. */
  probeInvalidated?: string[];
  error?: string;
}

/**
 * What `announce` does with a landed write: save the config the server answered
 * with, when there is one, re-read the catalog, and re-probe the harness tabs
 * whose cached answer the write invalidated.
 */
export type ProviderWriteAnnouncer = (
  id: string,
  config?: HarnessConfig,
  probeInvalidated?: readonly string[],
) => void;

/**
 * Turn one provider-write answer into what the card repeats.
 *
 * `detail` is the EVIDENCE — the protocol the probe chose, where it was written,
 * and the env lines a variable-name format needed. "Copied"/"Added" alone was a
 * claim the reader could not check, and measured imports differ in exactly that
 * detail.
 */
function outcomeOf(
  id: string,
  response: Response,
  payload: ProviderWritePayload,
  verb: string,
  announce: ProviderWriteAnnouncer,
): HarnessImportOutcome {
  if (!response.ok) {
    return { problem: payload.error ?? `${verb} failed (HTTP ${response.status})`, detail: null };
  }
  // An env-style target answered with a CONFIG; a registry target with what it
  // wrote. Both change what the card shows, so both are folded back in.
  announce(id, payload.config, payload.probeInvalidated);
  const imported = payload.imported;
  const parts = [
    payload.protocol ? `${payload.protocol} → ${payload.target ?? imported?.path ?? 'the agent'}` : null,
    payload.envWritten?.length ? `set ${payload.envWritten.join(', ')}` : null,
    ...(imported?.notes ?? []),
    payload.probe?.protocols.length ? `endpoint answered ${payload.probe.protocols.join(', ')}` : null,
  ].filter(Boolean);
  return { problem: null, detail: parts.join(' · ') || null };
}

/** POST one provider request and frame its answer. */
async function postProvider(
  id: string,
  body: Record<string, unknown>,
  verb: string,
  announce: ProviderWriteAnnouncer,
): Promise<HarnessImportOutcome> {
  try {
    const response = await fetch('/api/harness', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ probe: id, ...body }),
    });
    return outcomeOf(id, response, await response.json() as ProviderWritePayload, verb, announce);
  } catch (cause) {
    return { problem: cause instanceof Error ? cause.message : `${verb} failed`, detail: null };
  }
}

/**
 * Copy one provider out of a source registry into a harness.
 *
 * The ROW travels with the id because the writer needs the endpoint, protocol and
 * model list; the credential does not, and the route reads it from the source
 * file in the same request.
 */
export function importProvider(
  id: string,
  sourceId: string,
  entry: HarnessProviderSupport['importable'][number],
  announce: ProviderWriteAnnouncer,
): Promise<HarnessImportOutcome> {
  return postProvider(id, {
    importProvider: {
      from: entry.source,
      id: sourceId,
      entry: {
        name: entry.name,
        baseUrl: entry.baseUrl,
        protocol: entry.protocol,
        models: entry.models,
        contextWindow: entry.contextWindow,
      },
    },
  }, 'Import', announce);
}

/**
 * Type a provider in instead of copying one.
 *
 * The key travels — it was typed in this tab — and the route stores it exactly
 * where the target reads it: the entry for a registry, the harness env for a
 * variable-name format, the vendor's own variables for an environment harness.
 */
export function addProvider(
  id: string,
  input: AddProviderInput,
  announce: ProviderWriteAnnouncer,
): Promise<HarnessImportOutcome> {
  return postProvider(id, { addProvider: input }, 'Add', announce);
}
