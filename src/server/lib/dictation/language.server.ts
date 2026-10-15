/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The source language the dictation route sends to omp's STT worker.
 *
 * omp declares `stt.language` (default `"en"`) and its own dictation reads it
 * through `cfgSttLanguage`; the chamber drives the SAME worker but previously
 * passed no language at all, so every decode auto-detected. Measured at
 * 18.11.0: the worker only applies `language` for a non-`englishOnly` model
 * (Whisper tiers, and the Parakeet/Nemotron checkpoints ignore it), so the hint
 * matters exactly for the multilingual tiers the chamber defaults to.
 *
 * Read from the live config rather than mirrored, so a value the user edits in
 * Settings — or writes with `omp config set` — is what the next utterance uses.
 * Cached for a minute because the alternative is a ~0.3 s `omp` spawn per
 * utterance, and the config write route drops the cache so an edit applies at
 * once.
 */

import { getOmpConfigValue } from '@/server/lib/omp/config/config-cli';
import { isMockMode } from '@/server/mock.server';

const CACHE_TTL_MS = 60_000;

/** An ISO-639-1 tag, which is what the worker and Whisper both take. */
const LANGUAGE_TAG_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

/**
 * The module-scoped slot, anchored on `globalThis` for the reason the database
 * handle and the terminal registry are: `bun --hot` re-evaluates a changed
 * module in place, and a plain binding would drop a cache whose entries are
 * still valid.
 */
const cacheKey = '__ompChamberDictationLanguage';
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
 * The language tag to send, or `undefined` to let the recognizer auto-detect.
 *
 * An unusable or unset value yields `undefined` rather than a guess: the worker
 * treats an absent `language` as "auto-detect", which is the honest behaviour
 * for a config the chamber cannot read, and it is strictly better than pinning
 * every decode to English because a read failed.
 */
export async function resolveDictationLanguage(): Promise<string | undefined> {
  if (isMockMode()) return undefined;
  const host = globalThis as CacheHost;
  const cached = host[cacheKey];
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value || undefined;

  let value = '';
  try {
    const raw = await getOmpConfigValue('stt.language');
    value = typeof raw === 'string' && LANGUAGE_TAG_RE.test(raw.trim()) ? raw.trim() : '';
  } catch {
    // A failed read is not a language: fall through to auto-detect, and do not
    // cache the miss for a full minute (the next utterance retries).
    return undefined;
  }
  host[cacheKey] = { at: Date.now(), value };
  return value || undefined;
}
