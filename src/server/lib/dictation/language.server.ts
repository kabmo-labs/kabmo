/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * omp's own `stt.language`, read from the live config.
 *
 * The dictation route sends a language the CLIENT chose; this value is only the
 * fallback for the local engine in `auto` mode, where the alternative is
 * "nothing", and omp's worker then pins English anyway. Reading it live means a
 * value written with `omp config set` applies to the next utterance.
 *
 * Cached for a minute because the alternative is a ~0.3 s `omp` spawn per
 * utterance; the config write route drops the cache so an edit applies at once.
 */

import { getOmpConfigValue } from '@kabmo-labs/kabmo-omp/config-files/config-cli';
import { isMockMode } from '@kabmo-labs/kabmo-runtime-flags';

const CACHE_TTL_MS = 60_000;

/** An ISO-639-1 tag, which is what the worker and Whisper both take. */
const LANGUAGE_TAG_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

/**
 * The module-scoped slot, anchored on `globalThis` for the reason the database
 * handle and the terminal registry are: `bun --hot` re-evaluates a changed
 * module in place, and a plain binding would drop a cache whose entries are
 * still valid.
 */
const cacheKey = '__kabmoDictationLanguage';
type LanguageCache = { at: number; value: string } | null;
interface CacheHost { [cacheKey]?: LanguageCache }

/** Drop the cached language so the next utterance re-reads the config. */
export function invalidateDictationLanguage(): void {
  (globalThis as CacheHost)[cacheKey] = null;
}

/**
 * Drop what a config write invalidated, for the key that was written.
 *
 * The seam lives here rather than at the route because the module that owns a
 * cache is the one that knows which key feeds it — a route-side list of keys
 * would drift the first time a second setting is read into a cached value.
 */
export function onOmpConfigWritten(key: string): void {
  if (key === 'stt.language') invalidateDictationLanguage();
}

/**
 * omp's configured language tag, or `undefined` when it has none this build can
 * use.
 *
 * `undefined` is NOT "let the recognizer decide": the local worker's pipeline
 * treats a missing language as English (measured — see
 * `shared/lib/dictation/languages.ts`). It means "no stored intent", and the
 * caller substitutes `en` explicitly so the behaviour is stated rather than
 * implied.
 */
export async function readOmpSttLanguage(): Promise<string | undefined> {
  if (isMockMode()) return undefined;
  const host = globalThis as CacheHost;
  const cached = host[cacheKey];
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value || undefined;

  let value = '';
  try {
    const raw = await getOmpConfigValue('stt.language');
    value = typeof raw === 'string' && LANGUAGE_TAG_RE.test(raw.trim()) ? raw.trim() : '';
  } catch {
    // A failed read is not a language, and the miss is not cached: the next
    // utterance retries instead of pinning a full minute of guesses.
    return undefined;
  }
  host[cacheKey] = { at: Date.now(), value };
  return value || undefined;
}
