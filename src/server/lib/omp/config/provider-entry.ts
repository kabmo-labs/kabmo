/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Editing an EXISTING `models.yml` provider entry.
 *
 * `upsertOmpProviderModels` is add-only by design: a field the entry already
 * carries belongs to the user, and rewriting it would discard a credential or
 * endpoint they pinned. That rule is right for a model listing and wrong for
 * this panel's "edit connection": rotating a key, moving an endpoint, or
 * switching the dialect were all writes the UI offered and the writer silently
 * dropped — the new value went into Kabmo's SQLite overlay, the merge discarded
 * it because models.yml owned the slug, and the panel reported "connected"
 * while omp kept using the old credential.
 *
 * So the write is explicit here: a field present in the patch is SET, a field
 * explicitly null is REMOVED, and a field absent is left alone. The document
 * model keeps comments and unrelated keys, and the result is validated against
 * omp's own rules before it reaches disk (one violation disables every custom
 * provider in the file).
 */

import { isMap, type Document, type YAMLMap } from 'yaml';
import { getModelsConfigPath } from '@/server/lib/omp/config/models-config';
import { withOmpYamlDocument, OmpConfigError } from '@/server/lib/omp/config/document';
import { validateModelsDocument } from '@/server/lib/omp/config/models-validation';
import { isMaskedApiKey } from '@/shared/lib/models/provider/dialect';
import type {
  OmpProviderApi,
  ProviderAuthMode,
  ProviderDiscoveryType,
} from '@/shared/types/settings/provider';

/** omp's `ProviderDiscoverySchema`: a type plus its own optional knobs. */
export interface ProviderDiscoveryConfig {
  type: ProviderDiscoveryType;
  /** Probe timeout; must be a positive finite number of milliseconds. */
  timeoutMs?: number;
  /** `openai-models-list` only: skip the forced `/v1` prefix. */
  injectV1?: boolean;
  /** `/v1/models`-reading types only: trust the advertised reasoning ladder. */
  advertisedReasoning?: boolean;
}

export interface OmpProviderEntryPatch {
  baseUrl?: string | null;
  apiKey?: string | null;
  api?: OmpProviderApi | null;
  auth?: ProviderAuthMode | null;
  discovery?: ProviderDiscoveryConfig | null;
  headers?: Record<string, string> | null;
  authHeader?: boolean | null;
  transport?: 'pi-native' | null;
}

/**
 * The discovery block as omp's schema wants it: the type plus only the knobs
 * that type accepts.
 *
 * omp REJECTS `injectV1` outside `openai-models-list` and `advertisedReasoning`
 * outside the three types that read `/v1/models` rows — and a rejected field
 * disables every custom provider in the file, so the narrowing happens here
 * rather than trusting the caller's form state.
 */
function discoveryNode(doc: Document, discovery: ProviderDiscoveryConfig): unknown {
  const node: Record<string, unknown> = { type: discovery.type };
  if (discovery.type === 'openai-models-list' && discovery.injectV1 !== undefined) {
    node.injectV1 = discovery.injectV1;
  }
  if (
    (discovery.type === 'openai-models-list' || discovery.type === 'lm-studio' || discovery.type === 'proxy')
    && discovery.advertisedReasoning !== undefined
  ) {
    node.advertisedReasoning = discovery.advertisedReasoning;
  }
  if (
    discovery.timeoutMs !== undefined
    && Number.isFinite(discovery.timeoutMs)
    && discovery.timeoutMs > 0
  ) {
    node.timeoutMs = discovery.timeoutMs;
  }
  return doc.createNode(node);
}

export interface OmpProviderEntryWriteResult {
  written: boolean;
  /** Fields actually changed on disk, in the order they were applied. */
  changed: string[];
  reason?: string;
}

/**
 * Apply `patch` to one provider entry. Refuses when the entry does not exist —
 * creating one is the add-provider path, and a silent create here would write a
 * provider the caller never described (no models, no dialect).
 */
export async function updateOmpProviderEntry(
  slug: string,
  patch: OmpProviderEntryPatch,
): Promise<OmpProviderEntryWriteResult> {
  const path = await getModelsConfigPath();
  return withOmpYamlDocument<OmpProviderEntryWriteResult>(path, (doc) => {
    const providersNode = doc.get('providers');
    if (!isMap(providersNode)) {
      return {
        result: { written: false, changed: [], reason: 'models.yml has no providers mapping' },
        changed: false,
      };
    }
    // Captured BEFORE any edit: the validation below refuses only problems
    // this patch INTRODUCED, so a pre-existing violation elsewhere in the file
    // cannot make an unrelated provider uneditable.
    const original = doc.toJS() as Record<string, unknown> | null;
    const entry = (providersNode as YAMLMap).get(slug);
    if (!isMap(entry)) {
      return {
        result: {
          written: false,
          changed: [],
          reason: `"${slug}" has no models.yml entry — add the provider first`,
        },
        changed: false,
      };
    }

    // A masked placeholder is what the UI echoes for a stored key. Writing it
    // would replace a working credential with a string that authenticates
    // nothing, which is worse than leaving the old one in place.
    if (typeof patch.apiKey === 'string' && isMaskedApiKey(patch.apiKey)) {
      return {
        result: { written: false, changed: [], reason: 'the supplied API key is a masked placeholder, not a credential' },
        changed: false,
      };
    }

    const applied: string[] = [];
    const apply = (key: string, value: unknown, encoded: unknown): void => {
      if (value === undefined) return;
      if (value === null || (typeof value === 'string' && value.trim().length === 0)) {
        if (entry.has(key)) {
          entry.delete(key);
          applied.push(key);
        }
        return;
      }
      entry.set(key, encoded);
      applied.push(key);
    };

    apply('baseUrl', patch.baseUrl, typeof patch.baseUrl === 'string' ? patch.baseUrl.trim() : patch.baseUrl);
    apply('apiKey', patch.apiKey, typeof patch.apiKey === 'string' ? patch.apiKey.trim() : patch.apiKey);
    apply('api', patch.api, patch.api);
    // `auth: apiKey` is omp's DEFAULT, so writing it would pin a value the file
    // does not need; deleting the key expresses the same thing.
    apply('auth', patch.auth === 'apiKey' ? null : patch.auth, patch.auth);
    apply(
      'discovery',
      patch.discovery,
      patch.discovery ? discoveryNode(doc, patch.discovery) : patch.discovery,
    );
    apply(
      'headers',
      patch.headers,
      patch.headers ? doc.createNode(patch.headers) : patch.headers,
    );
    // `false` is omp's default for both of these, so only `true` is worth a key.
    apply('authHeader', patch.authHeader === false ? null : patch.authHeader, patch.authHeader);
    apply('transport', patch.transport, patch.transport);

    if (applied.length === 0) {
      return { result: { written: false, changed: [], reason: 'nothing to change' }, changed: false };
    }

    // A models-carrying entry needs a dialect at provider or model level; a
    // patch that cleared it would disable the provider, so refuse instead of
    // writing a file omp rejects.
    const models = entry.get('models');
    if (models !== undefined && !entry.has('api')) {
      throw new OmpConfigError(
        `${path}: provider "${slug}" still lists models and needs an "api" — set the wire dialect before saving.`,
      );
    }

    const errorsAfter = validateModelsDocument(doc.toJS() as Record<string, unknown>);
    const preExisting = new Set(validateModelsDocument(original));
    const introduced = errorsAfter.filter((error) => !preExisting.has(error));
    if (introduced.length > 0) {
      throw new OmpConfigError(`Refusing to write an invalid models.yml: ${introduced[0]}`);
    }

    return { result: { written: true, changed: applied }, changed: true };
  });
}

