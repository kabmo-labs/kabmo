/**
 * Server-side access to the models.dev catalog (https://models.dev/api.json):
 * a mapping of provider slug → model id → { name, attachment, reasoning,
 * tool_call, limit.context/output, cost.input/output }. Used as the metadata
 * fallback for provider models whose listing endpoint (/v1/models) only
 * returns bare ids. Cached in-process for 1 hour with graceful degradation —
 * catalog failures never fail the caller.
 */

const CATALOG_URL = 'https://models.dev/api.json';
const CATALOG_TTL_MS = 60 * 60 * 1000;
const CATALOG_TIMEOUT_MS = 8_000;

export interface CatalogModelInfo {
  name?: string;
  attachment?: boolean;
  reasoning?: boolean;
  tool_call?: boolean;
  /** Canonical model id that other provider listings reference. */
  canonical_model_id?: string;
  limit?: { context?: number; output?: number };
  cost?: { input?: number; output?: number; cache_read?: number; cache_write?: number };
}

type ModelsDevCatalog = Record<string, { models?: Record<string, CatalogModelInfo> }>;

export interface CatalogLoadOptions {
  timeoutMs?: number;
  /**
   * When true, a failed fetch or malformed payload throws instead of
   * degrading to cached/empty data — callers that surface an error envelope
   * (pricing) opt in.
   */
  strict?: boolean;
}

declare global {
  // eslint-disable-next-line no-var
  var __kabmoModelsDevCatalog: { data: ModelsDevCatalog; expiresAt: number } | undefined;
}

export async function loadModelsDevCatalog(options: CatalogLoadOptions = {}): Promise<ModelsDevCatalog> {
  const { timeoutMs = CATALOG_TIMEOUT_MS, strict = false } = options;
  const cached = globalThis.__kabmoModelsDevCatalog;
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  try {
    const response = await fetch(CATALOG_URL, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      if (strict) throw new Error(`models.dev responded ${response.status}`);
      return cached?.data ?? {};
    }
    const data = await response.json() as ModelsDevCatalog;
    if (!data || typeof data !== 'object') {
      if (strict) throw new Error('models.dev payload is not an object');
      return cached?.data ?? {};
    }
    globalThis.__kabmoModelsDevCatalog = { data, expiresAt: Date.now() + CATALOG_TTL_MS };
    return data;
  } catch (error) {
    if (strict) throw error;
    return cached?.data ?? {};
  }
}

/** Minimum prefix-match score to accept (100 = exact at segment level). */
const PREFIX_SCORE_THRESHOLD = 70;

/** Minimum number of leading hyphen-segments that must match exactly. */
const MIN_SEGMENTS_MATCH = 2;

/**
 * Strip a `:variant` suffix from a model id, e.g.
 * `deepseek-v4-flash-0731:netra` → `deepseek-v4-flash-0731`.
 */
function stripVariant(modelId: string): string {
  const colon = modelId.indexOf(':');
  return colon >= 0 ? modelId.slice(0, colon) : modelId;
}

/**
 * Normalize version dots to dashes: `v3.1` → `v3-1`.
 */
function normalizeVersion(modelId: string): string {
  return modelId.replace(/\b(\d+)\.(\d+)\b/g, '$1-$2');
}

/**
 * Prefix-based similarity: compare hyphen-segments from the start,
 * penalizing each mismatching segment by 20, then each extra segment
 * on the longer side by 10. Returns 0–100.
 */
function calculatePrefixScore(modelA: string, modelB: string): number {
  const partsA = modelA.split('-');
  const partsB = modelB.split('-');
  const minLen = Math.min(partsA.length, partsB.length);
  const maxLen = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < minLen; i++) {
    if (partsA[i] !== partsB[i]) {
      const mismatchPenalty = Math.max(0, 100 - i * 20);
      return Math.max(0, mismatchPenalty);
    }
  }
  // All compared segments match — penalise only extra length
  return Math.max(0, 100 - (maxLen - minLen) * 10);
}

/**
 * Convert a lowercase-kebab model name to PascalCase
 * (e.g. "deepseek-v4-flash-0731" → "DeepSeek-V4-Flash-0731").
 */
function toPascalCase(name: string): string {
  return name.split('-').map(seg => seg.charAt(0).toUpperCase() + seg.slice(1)).join('-');
}

/**
 * Look up a model in the catalog using progressive matching levels:
 *
 * 1. **Exact** — model id as-is, with and without `:variant` suffix
 * 2. **Provider + model name** — match `providerKey/modelName` after normalising
 * 3. **Model name only** — match the bare model name (ignore provider)
 * 4. **Prefix scoring** — hyphen-segment prefix match with minimum threshold
 *
 * When a catalog entry carries a `canonical_model_id` it is used as the
 * authoritative canonical match — the first entry with a matching
 * canonical id wins.
 */
export function findCatalogModel(
  catalog: ModelsDevCatalog,
  providerSlug: string | undefined,
  modelId: string,
): { info: CatalogModelInfo; providerKey: string } | null {
  const cleanId = stripVariant(modelId);
  const modelName = cleanId.includes('/') ? cleanId.split('/').pop()! : cleanId;
  const normName = normalizeVersion(modelName);

  // --- Level 1: Exact match ---
  for (const id of [modelId, cleanId]) {
    const candidates = new Set<string>();
    if (providerSlug) candidates.add(providerSlug);
    const slash = cleanId.indexOf('/');
    if (slash >= 0) candidates.add(cleanId.slice(0, slash));

    for (const providerKey of candidates) {
      const info = catalog[providerKey]?.models?.[id];
      if (info) return { info, providerKey };
    }

    // Fallback: check canonical_model_id across ALL providers
    const canon = findByCanonicalId(catalog, id);
    if (canon) return canon;
  }

  // --- Level 2: Provider + model name match ---
  if (providerSlug || cleanId.includes('/')) {
    const prov = providerSlug ?? cleanId.split('/')[0];
    for (const candidateName of [modelName, normName]) {
      const info = catalog[prov]?.models?.[candidateName];
      if (info) return { info, providerKey: prov };

      // Also check PascalCase variants (e.g. deepseek-ai/DeepSeek-V4-Flash-0731)
      const pascal = toPascalCase(candidateName);
      if (pascal !== candidateName) {
        const pascalInfo = catalog[prov]?.models?.[pascal];
        if (pascalInfo) return { info: pascalInfo, providerKey: prov };
      }
    }

    // Fallback: canonical match on the normalised name
    const canon = findByCanonicalId(catalog, modelName) ?? findByCanonicalId(catalog, normName);
    if (canon) return canon;
  }

  // --- Level 3: Model name only (ignore provider, case-insensitive) ---
  const modelNameLower = modelName.toLowerCase();
  const normLower = normalizeVersion(modelNameLower);

  const level3Names: string[] = [modelNameLower, normLower];
  const pascal = toPascalCase(modelName);
  if (pascal !== modelName) level3Names.push(pascal);

  for (const name of level3Names) {
    for (const [, providerData] of Object.entries(catalog)) {
      const models = providerData?.models || {};
      for (const [modelKey, modelData] of Object.entries(models)) {
        const devModel = modelKey.split('/').pop()!;
        if (devModel === name) {
          return { info: modelData, providerKey: resolveProviderKey(catalog, modelKey) };
        }
      }
    }
  }

  // --- Level 4: Prefix scoring ---
  const nameForScoring = normalizeVersion(modelNameLower);
  let bestMatch: { info: CatalogModelInfo; providerKey: string } | null = null;
  let bestScore = 0;

  for (const [providerKey, providerData] of Object.entries(catalog)) {
    const models = providerData?.models || {};
    for (const [modelKey, modelData] of Object.entries(models)) {
      const devModel = modelKey.split('/').pop()!.toLowerCase();
      const score = calculatePrefixScore(nameForScoring, normalizeVersion(devModel));
      if (score > bestScore && score >= PREFIX_SCORE_THRESHOLD) {
        // At least MIN_SEGMENTS_MATCH leading segments must match exactly
        const inputParts = nameForScoring.split('-');
        const devParts = normalizeVersion(devModel).split('-');
        let segmentsMatch = 0;
        for (let i = 0; i < Math.min(inputParts.length, devParts.length); i++) {
          if (inputParts[i] === devParts[i]) segmentsMatch++;
          else break;
        }
        if (segmentsMatch >= MIN_SEGMENTS_MATCH) {
          bestScore = score;
          bestMatch = { info: modelData, providerKey };
        }
      }
    }
  }

  return bestMatch;
}

/**
 * Return the provider key for a catalog model key.
 * "deepseek-ai/DeepSeek-V4-Flash-0731" → "deepseek-ai".
 */
function resolveProviderKey(catalog: ModelsDevCatalog, modelKey: string): string {
  const slash = modelKey.indexOf('/');
  if (slash >= 0) return modelKey.slice(0, slash);
  // Bare key — find which provider owns it
  for (const [pk, pd] of Object.entries(catalog)) {
    if (pd?.models?.[modelKey]) return pk;
  }
  return modelKey;
}

/**
 * Search every provider for a model entry whose `canonical_model_id` matches
 * the given model id (either full id or the bare model name).
 */
function findByCanonicalId(
  catalog: ModelsDevCatalog,
  modelId: string,
): { info: CatalogModelInfo; providerKey: string } | null {
  const bareName = modelId.includes('/') ? modelId.split('/').pop()! : modelId;
  for (const [providerKey, providerData] of Object.entries(catalog)) {
    const models = providerData?.models || {};
    for (const [, modelData] of Object.entries(models)) {
      if (modelData.canonical_model_id === modelId || modelData.canonical_model_id === bareName) {
        return { info: modelData, providerKey };
      }
    }
  }
  return null;
}
