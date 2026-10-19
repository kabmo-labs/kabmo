/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Per-model overrides in omp's own registry (`models.yml` →
 * `providers.<slug>.modelOverrides.<modelId>`).
 *
 * omp resolves sampling per MODEL from here and globally from `config.yml`
 * (`temperature`, `topP`, `topK`, `minP`), with no per-model temperature at
 * all. The Kabmo's model dialog therefore only offers what omp honours:
 * `maxTokens` and a reasoning `thinking` block. Writing them anywhere else
 * (the SQLite overlay) left the controls inert — the UI showed a value the
 * agent never applied.
 */

import { isMap, type Document } from 'yaml';
import { getModelsConfigPath } from '@/server/lib/omp/config/models-config';
import { plainOf, withOmpYamlDocument, OmpConfigError } from '@/server/lib/omp/config/document';

/** Effort levels omp's `ThinkingConfig.efforts` accepts. */
export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ModelOverrideInput {
  provider: string;
  modelId: string;
  /** Output-token cap; `null` clears the override. */
  maxTokens?: number | null;
  /** Default reasoning effort; `null` clears the thinking override. */
  reasoningEffort?: ReasoningEffort | null;
}

export interface ModelOverrideResult {
  written: boolean;
  /** True when the provider/model pair does not exist in models.yml. */
  unknownTarget?: boolean;
  reason?: string;
}

/** True when the provider entry holds the given model id. */
function hasModel(doc: Document, provider: string, modelId: string): boolean {
  const providers = doc.get('providers');
  if (!isMap(providers)) return false;
  const entry = providers.get(provider);
  if (!isMap(entry)) return false;
  const models = plainOf<Array<{ id?: string }>>(doc, entry.get('models'));
  return Array.isArray(models) && models.some((model) => model?.id === modelId);
}

/**
 * Write `maxTokens` / `reasoning` overrides for one model. An override that is
 * cleared is deleted rather than written as `null`, so the model falls back to
 * the catalog value; when nothing remains the whole `modelOverrides` entry goes
 * away. The provider must already hold the model — an override for an
 * unregistered id is silently ignored by omp.
 */
export async function writeModelOverride(input: ModelOverrideInput): Promise<ModelOverrideResult> {
  const path = await getModelsConfigPath();
  return withOmpYamlDocument<ModelOverrideResult>(path, (doc) => {
    if (!hasModel(doc, input.provider, input.modelId)) {
      return {
        result: {
          written: false,
          unknownTarget: true,
          reason: `${input.modelId} is not registered under provider "${input.provider}" in models.yml`,
        },
        changed: false,
      };
    }

    const overrides = doc.getIn(['providers', input.provider, 'modelOverrides']);
    if (overrides !== undefined && !isMap(overrides)) {
      throw new OmpConfigError(`${path}: providers.${input.provider}.modelOverrides must be a mapping`);
    }

    const existing = isMap(overrides) ? overrides.get(input.modelId) : undefined;
    if (existing !== undefined && !isMap(existing)) {
      throw new OmpConfigError(`${path}: providers.${input.provider}.modelOverrides.${input.modelId} must be a mapping`);
    }
    const entry = isMap(existing) ? existing : undefined;

    // Applying through `setIn` materializes the intermediate maps as YAML
    // nodes, so a fresh override nests correctly.
    if (input.maxTokens !== undefined) {
      if (input.maxTokens === null) doc.deleteIn(['providers', input.provider, 'modelOverrides', input.modelId, 'maxTokens']);
      else if (!(input.maxTokens > 0)) throw new OmpConfigError('maxTokens must be a positive number');
      else doc.setIn(['providers', input.provider, 'modelOverrides', input.modelId, 'maxTokens'], input.maxTokens);
    }

    if (input.reasoningEffort !== undefined) {
      if (input.reasoningEffort === null) {
        doc.deleteIn(['providers', input.provider, 'modelOverrides', input.modelId, 'thinking']);
      } else {
        // `efforts` must list the level the model may use; the previous list is
        // kept when there is one so a catalog-provided vocabulary is not
        // narrowed to a single value by a default-level change.
        const previous = entry ? plainOf<{ efforts?: string[] }>(doc, entry.get('thinking')) : undefined;
        const efforts = Array.isArray(previous?.efforts) && previous.efforts.length > 0
          ? [...new Set([...previous.efforts, input.reasoningEffort])]
          : ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
        doc.setIn(['providers', input.provider, 'modelOverrides', input.modelId, 'thinking'], {
          mode: 'effort',
          efforts,
          defaultLevel: input.reasoningEffort,
        });
      }
    }

    // An override left with no keys is dead weight — drop it so the model
    // returns to the pure catalog definition.
    const after = doc.getIn(['providers', input.provider, 'modelOverrides', input.modelId]);
    if (isMap(after) && after.items.length === 0) {
      doc.deleteIn(['providers', input.provider, 'modelOverrides', input.modelId]);
    }
    const parent = doc.getIn(['providers', input.provider, 'modelOverrides']);
    if (isMap(parent) && parent.items.length === 0) {
      doc.deleteIn(['providers', input.provider, 'modelOverrides']);
    }

    return { result: { written: true }, changed: true };
  });
}
