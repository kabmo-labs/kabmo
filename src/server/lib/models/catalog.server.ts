/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The model catalog the provider panel draws — from `omp models --json --kind
 * all`, the same listing omp's own `/models` hub reads.
 *
 * `get_available_models` over RPC answers CHAT models only
 * (`modelRegistry.getAvailable()` defaults to kind `chat`), so an embedding,
 * image, judge, tts, stt, search, rerank or video model never appeared in the
 * panel at all — and the row's own `kind`, `thinking`, `input` and `cost` were
 * dropped, which is why every model read `hasVision: false` / `hasTools: true`
 * regardless of what omp actually knew.
 *
 * Cached for a minute on `globalThis` (a listing spawn costs ~1.3 s and the
 * panel reads it on open and on Refresh), and dropped by
 * `invalidateModelsCaches` like every other registry snapshot.
 */

import { readOmpModelsJson, type OmpModelsRow } from '@/server/lib/omp/core/models-json';
import { isMockMode } from '@/server/mock.server';
import { formatContextWindow } from '@/shared/lib/code/format';
import { modelKindOf } from '@/shared/lib/models/provider/dialect';
import { isRecord } from '@/shared/lib/util/guards';

const CATALOG_TTL_MS = 60_000;

/** One model row, as the settings panel needs it. */
export interface CatalogModel {
  id: string;
  name: string;
  provider: string;
  kind: string;
  selector: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  thinking?: { mode?: string; efforts: string[] };
  input: string[];
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
  pricingStatus?: string;
}

/** The compact context badge the panel prints (`1M ctx · 384K out`). */
export function catalogContextLabel(model: Pick<CatalogModel, 'contextWindow' | 'maxTokens'>): string {
  const context = model.contextWindow ? formatContextWindow(model.contextWindow) : '';
  const out = model.maxTokens ? formatContextWindow(model.maxTokens) : '';
  if (context && out) return `${context} ctx · ${out} out`;
  if (context) return `${context} ctx`;
  return '';
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

/**
 * One `omp models --json` row → a catalog model, or null when unusable.
 *
 * Every field is narrowed: the JSON comes from a binary this module does not
 * compile against, so a retyped or missing field must degrade the row rather
 * than the listing.
 */
export function toCatalogModel(raw: OmpModelsRow): CatalogModel | null {
  const provider = raw.provider;
  const id = raw.id;
  if (typeof provider !== 'string' || typeof id !== 'string') return null;
  const thinking = typeof raw.thinking === 'object' && raw.thinking !== null ? raw.thinking : undefined;
  const thinkingMode = thinking && 'mode' in thinking && typeof thinking.mode === 'string'
    ? thinking.mode
    : undefined;
  const efforts = thinking && 'efforts' in thinking ? stringsOf(thinking.efforts) : [];
  const cost = isRecord(raw.cost) ? raw.cost : undefined;
  const costOf = (key: 'input' | 'output' | 'cacheRead' | 'cacheWrite'): number | undefined => (
    cost && key in cost ? numberOrUndefined(cost[key]) : undefined
  );
  const hasCost = cost !== undefined
    && costOf('input') !== undefined
    && costOf('output') !== undefined;
  return {
    id,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : id,
    provider,
    kind: modelKindOf(raw.kind),
    selector: typeof raw.selector === 'string' ? raw.selector : `${provider}/${id}`,
    ...(numberOrUndefined(raw.contextWindow) !== undefined
      ? { contextWindow: numberOrUndefined(raw.contextWindow) }
      : {}),
    ...(numberOrUndefined(raw.maxTokens) !== undefined ? { maxTokens: numberOrUndefined(raw.maxTokens) } : {}),
    ...(raw.reasoning === true ? { reasoning: true } : {}),
    ...(thinking && (thinkingMode !== undefined || efforts.length > 0)
      ? { thinking: { ...(thinkingMode ? { mode: thinkingMode } : {}), efforts } }
      : {}),
    input: stringsOf(raw.input),
    ...(hasCost ? {
      cost: {
        input: costOf('input'),
        output: costOf('output'),
        cacheRead: costOf('cacheRead'),
        cacheWrite: costOf('cacheWrite'),
      },
    } : {}),
    ...(typeof raw.pricingStatus === 'string' ? { pricingStatus: raw.pricingStatus } : {}),
  };
}

/** Rows grouped by provider slug (lower-cased), each provider's list sorted by id. */
export type CatalogByProvider = Map<string, CatalogModel[]>;

function groupByProvider(models: CatalogModel[]): CatalogByProvider {
  const byProvider: CatalogByProvider = new Map();
  for (const model of models) {
    const slug = model.provider.trim().toLowerCase();
    const list = byProvider.get(slug);
    if (list) list.push(model);
    else byProvider.set(slug, [model]);
  }
  for (const list of byProvider.values()) list.sort((a, b) => a.id.localeCompare(b.id));
  return byProvider;
}

/** The whole catalog, from cache when warm. */
export async function readModelCatalog(): Promise<{ models: CatalogModel[]; error: string | null }> {
  if (isMockMode()) return { models: [], error: null };
  const cached = globalThis.__kabmoModelCatalogCache;
  if (cached && cached.expiresAt > Date.now()) return { models: cached.data, error: null };
  try {
    const rows = await readOmpModelsJson({ kind: 'all' });
    const models = rows.flatMap((row) => {
      const model = toCatalogModel(row);
      return model ? [model] : [];
    });
    globalThis.__kabmoModelCatalogCache = { data: models, expiresAt: Date.now() + CATALOG_TTL_MS };
    return { models, error: null };
  } catch (error) {
    return { models: [], error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * The catalog grouped per provider. A read failure is REPORTED rather than
 * thrown: the provider list itself comes from other sources and stays usable,
 * and an empty model list with no explanation reads as "this provider serves
 * nothing".
 */
export async function readModelCatalogByProvider(): Promise<{ byProvider: CatalogByProvider; error: string | null }> {
  const { models, error } = await readModelCatalog();
  return { byProvider: groupByProvider(models), error };
}

/** One provider's models from the catalog, or an empty list. */
export async function readProviderCatalog(slug: string): Promise<CatalogModel[]> {
  const { byProvider } = await readModelCatalogByProvider();
  return byProvider.get(slug.trim().toLowerCase()) ?? [];
}

/** How many models each provider serves, keyed by lower-case slug. */
export async function readCatalogCounts(): Promise<{ counts: Map<string, number>; error: string | null }> {
  const { byProvider, error } = await readModelCatalogByProvider();
  const counts = new Map<string, number>();
  for (const [slug, list] of byProvider) counts.set(slug, list.length);
  return { counts, error };
}

/**
 * Force omp to re-run discovery for every provider (`omp models refresh`), then
 * report what moved.
 *
 * This is omp's own refresh — the CLI's `refresh` subcommand is the documented
 * way to ignore the catalog cache, and there is no provider-scoped equivalent:
 * the RPC exposes no refresh command, and `ModelRegistry.refreshProvider` is
 * internal. Reporting per-provider deltas is what makes the result honest
 * about being a catalog-wide refresh rather than a per-provider discovery.
 */
export async function refreshModelCatalog(): Promise<{
  ok: boolean;
  error?: string;
  added: number;
  removed: number;
  changed: Array<{ slug: string; before: number; after: number }>;
}> {
  if (isMockMode()) return { ok: false, error: 'Refresh is unavailable in mock mode', added: 0, removed: 0, changed: [] };
  const before = await readCatalogCounts();
  try {
    const rows = await readOmpModelsJson({ refresh: true, kind: 'all' });
    const models = rows.flatMap((row) => {
      const model = toCatalogModel(row);
      return model ? [model] : [];
    });
    globalThis.__kabmoModelCatalogCache = { data: models, expiresAt: Date.now() + CATALOG_TTL_MS };
    const after = new Map<string, number>();
    for (const model of models) {
      const slug = model.provider.trim().toLowerCase();
      after.set(slug, (after.get(slug) ?? 0) + 1);
    }
    const slugs = new Set([...before.counts.keys(), ...after.keys()]);
    const changed: Array<{ slug: string; before: number; after: number }> = [];
    let added = 0;
    let removed = 0;
    for (const slug of slugs) {
      const was = before.counts.get(slug) ?? 0;
      const now = after.get(slug) ?? 0;
      if (was === now) continue;
      changed.push({ slug, before: was, after: now });
      if (now > was) added += now - was;
      else removed += was - now;
    }
    changed.sort((a, b) => a.slug.localeCompare(b.slug));
    return { ok: true, added, removed, changed };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      added: 0,
      removed: 0,
      changed: [],
    };
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __kabmoModelCatalogCache: { data: CatalogModel[]; expiresAt: number } | undefined;
}
