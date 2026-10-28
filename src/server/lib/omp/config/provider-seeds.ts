/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Model-entry plumbing for the models.yml writer: the seed shape a provider
 * listing produces, the YAML entry omp expects for it, and the backfill of
 * metadata a bare existing entry is missing.
 *
 * Split from `./providers.ts` (the provider-level upsert) so each file stays
 * under the repo's size ceiling; both are one write path.
 */

import type { Document, YAMLMap } from 'yaml';
import { sanitizeModelEntry } from '@/server/lib/omp/config/models-validation';
import { plainOf } from '@/server/lib/omp/config/document';
import { isRecord } from '@/shared/lib/util/guards';
import type { ProviderThinkingEffort } from '@/shared/lib/models/provider/dialect';

/** One model entry destined for models.yml (cost numbers are USD per 1M tokens). */
export interface OmpProviderModelSeed {
  id: string;
  name?: string;
  /**
   * omp's `ModelKind`. Absent means chat, which is what omp assumes — so only a
   * non-chat kind is written, and an embedding/image/judge model stops looking
   * like a chat model that behaves oddly.
   */
  kind?: string;
  reasoning?: boolean;
  imageInput?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  /**
   * The reasoning ladder this model accepts, lowest first (`thinking.efforts`).
   *
   * Only written when the user picks a subset: an EMPTY list is what omp
   * already assumes for a reasoning model, so writing `efforts: []` would add a
   * block that changes nothing while claiming to be a configuration.
   */
  efforts?: ProviderThinkingEffort[];
}

/** The model ids already registered under `provider`, array form only. */
export function knownModelIds(provider: Record<string, unknown> | undefined): Set<string> {
  if (!Array.isArray(provider?.models)) return new Set();
  return new Set(
    provider.models
      .map((model) => (isRecord(model) && typeof model.id === 'string' ? model.id : ''))
      .filter(Boolean),
  );
}

/** The model entry as omp expects it, omitting anything omp would reject. */
export function toModelEntry(model: OmpProviderModelSeed): Record<string, unknown> {
  const efforts = model.efforts && model.efforts.length > 0 ? model.efforts : undefined;
  return sanitizeModelEntry({
    id: model.id,
    ...(model.name ? { name: model.name } : {}),
    ...(model.kind && model.kind !== 'chat' ? { kind: model.kind } : {}),
    ...(model.reasoning !== undefined ? { reasoning: model.reasoning } : {}),
    ...(efforts ? { thinking: { mode: 'effort', efforts } } : {}),
    ...(model.imageInput ? { input: ['text', 'image'] } : { input: ['text'] }),
    ...(model.contextWindow && model.contextWindow > 0 ? { contextWindow: model.contextWindow } : {}),
    ...(model.maxTokens && model.maxTokens > 0 ? { maxTokens: model.maxTokens } : {}),
    ...(model.cost ? { cost: model.cost } : {}),
  });
}

/**
 * Metadata a bare existing entry is missing, taken from the freshly fetched
 * seed. Values already present are never touched.
 */
export function backfillEntry(doc: Document, entry: YAMLMap, seed: OmpProviderModelSeed): void {
  if (seed.name && !entry.has('name')) entry.set('name', seed.name);
  if (seed.reasoning !== undefined && !entry.has('reasoning')) {
    entry.set('reasoning', seed.reasoning);
  }
  const currentInput = plainOf<string[]>(doc, entry.get('input'));
  if (seed.imageInput && (!Array.isArray(currentInput) || !currentInput.includes('image'))) {
    entry.set('input', ['text', 'image']);
  }
  if (seed.contextWindow && seed.contextWindow > 0 && !plainOf(doc, entry.get('contextWindow'))) {
    entry.set('contextWindow', seed.contextWindow);
  }
  if (seed.maxTokens && seed.maxTokens > 0 && !plainOf(doc, entry.get('maxTokens'))) {
    entry.set('maxTokens', seed.maxTokens);
  }
  if (seed.cost && !entry.has('cost')) {
    entry.set('cost', seed.cost);
  }
}

/**
 * Overwrite model metadata from the fetched seed — unlike `backfillEntry`,
 * this replaces values that already exist. Used when the user explicitly
 * fetches models from the provider endpoint and expects the data to be
 * refreshed.
 */
export function updateEntry(_doc: Document, entry: YAMLMap, seed: OmpProviderModelSeed): void {
  if (seed.name) entry.set('name', seed.name);
  if (seed.reasoning !== undefined) entry.set('reasoning', seed.reasoning);
  if (seed.imageInput !== undefined) {
    entry.set('input', seed.imageInput ? ['text', 'image'] : ['text']);
  }
  if (seed.contextWindow && seed.contextWindow > 0) entry.set('contextWindow', seed.contextWindow);
  if (seed.maxTokens && seed.maxTokens > 0) entry.set('maxTokens', seed.maxTokens);
  if (seed.cost) entry.set('cost', seed.cost);
}

/**
 * Existing entries worth backfilling: a bare id whose seed now carries
 * metadata the entry lacks (context window, price, reasoning, image input).
 */
export function backfillableIds(
  existingModels: unknown,
  incomingById: Map<string, OmpProviderModelSeed>,
): string[] {
  if (!Array.isArray(existingModels)) return [];
  return existingModels
    .filter((model): model is Record<string, unknown> => {
      if (!isRecord(model) || typeof model.id !== 'string') return false;
      const seed = incomingById.get(model.id);
      if (!seed) return false;
      const missingContext = typeof model.contextWindow !== 'number' || !model.contextWindow;
      return Boolean(
        (missingContext && (seed.contextWindow || seed.maxTokens))
        || (!model.cost && seed.cost)
        || (seed.reasoning !== undefined && model.reasoning === undefined)
        || (!Array.isArray(model.input) && seed.imageInput),
      );
    })
    .map((model) => String(model.id));
}

/**
 * Existing entries whose metadata should be overwritten from the fetched seed:
 * every model id present in BOTH existing and incoming, not just those with
 * missing fields.
 */
export function updatableIds(
  existingModels: unknown,
  incomingById: Map<string, OmpProviderModelSeed>,
): string[] {
  if (!Array.isArray(existingModels)) return [];
  return existingModels
    .filter((model): model is Record<string, unknown> => {
      if (!isRecord(model) || typeof model.id !== 'string') return false;
      return incomingById.has(model.id);
    })
    .map((model) => String(model.id));
}

/**
 * Existing entries the listing no longer carries — the ids a replace removes.
 * An entry with no usable `id` is never pruned: it is not addressable, and
 * dropping it would delete a model the user wrote by hand without saying so.
 */
export function prunableIds(
  existingModels: unknown,
  incomingById: Map<string, OmpProviderModelSeed>,
): string[] {
  if (!Array.isArray(existingModels)) return [];
  return existingModels
    .filter((model): model is Record<string, unknown> => (
      isRecord(model) && typeof model.id === 'string' && !incomingById.has(model.id)
    ))
    .map((model) => String(model.id));
}

/**
 * A model seed built from MANUAL user input (the "Add model" dialog) rather
 * than a provider listing.
 *
 * Numbers arrive as tokens, not as the compact labels a listing produces, so
 * there is nothing to parse — but the same rules apply: omp rejects the whole
 * file over a non-positive `contextWindow`/`maxTokens` or a partial `cost`, so
 * anything not usable is dropped here rather than written and rejected later.
 */
export interface ManualModelInput {
  id: string;
  name?: string;
  /** omp's `ModelKind`; `chat` (the default) is not written. */
  kind?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  imageInput?: boolean;
  costInput?: number;
  costOutput?: number;
  costCacheRead?: number;
  costCacheWrite?: number;
  /** Subset of omp's effort ladder this model accepts; empty means "not declared". */
  efforts?: ProviderThinkingEffort[];
}

export function manualModelSeed(input: ManualModelInput): OmpProviderModelSeed {
  const positive = (value: unknown): number | undefined => (
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : undefined
  );
  const finite = (value: unknown): number | undefined => (
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
  );
  const costInput = finite(input.costInput);
  const costOutput = finite(input.costOutput);
  const hasCost = costInput !== undefined && costOutput !== undefined;
  const efforts = input.reasoning && input.efforts && input.efforts.length > 0
    ? [...new Set(input.efforts)]
    : undefined;
  return {
    id: input.id.trim(),
    ...(input.name?.trim() ? { name: input.name.trim() } : {}),
    ...(input.kind && input.kind !== 'chat' ? { kind: input.kind } : {}),
    ...(input.reasoning ? { reasoning: true } : {}),
    ...(efforts ? { efforts } : {}),
    ...(input.imageInput ? { imageInput: true } : {}),
    ...(positive(input.contextWindow) ? { contextWindow: positive(input.contextWindow) } : {}),
    ...(positive(input.maxTokens) ? { maxTokens: positive(input.maxTokens) } : {}),
    ...(hasCost ? {
      cost: {
        input: costInput,
        output: costOutput,
        cacheRead: finite(input.costCacheRead) ?? 0,
        cacheWrite: finite(input.costCacheWrite) ?? 0,
      },
    } : {}),
  };
}
