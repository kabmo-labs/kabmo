/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The dictation preference, its shipped values, and the clamps every reader
 * applies.
 *
 * One module because the settings form, the client hook and the server route all
 * need the same answer to "what does an absent or hostile value mean?". The
 * stored object is untrusted (a direct API write, a downgrade, a hand-edited
 * row), so the clamps live here rather than in each caller.
 *
 * The API key is deliberately NOT part of this object: the settings blob is
 * injected into the page, so a key stored here would be readable by any script
 * on the origin. It lives in `~/.kabmo/dictation.json` (0600) and is written by
 * its own route.
 */

import {
  dictationEngine,
  isDictationEngine,
  type DictationEngine,
} from '@/shared/lib/dictation/engines';
import {
  defaultDictationLanguage,
  isDictationLanguage,
  type DictationLanguage,
} from '@/shared/lib/dictation/languages';
import { DICTATION_MAX_MS, DICTATION_MIN_MS } from '@/shared/lib/dictation/gate';
import { normalizeBaseUrl } from '@/shared/lib/net/base-url';

export interface DictationConfig {
  engine: DictationEngine;
  /** '' means "the engine's default model". */
  model: string;
  language: DictationLanguage;
  /** '' means "the engine's default endpoint". Only the openai engine reads it. */
  baseUrl: string;
  /** Vocabulary/domain hint forwarded as `prompt`; '' sends none. */
  prompt: string;
  /** Microphone `deviceId`; '' follows the OS default input. */
  deviceId: string;
  minMs: number;
  maxMs: number;
}

/** Shipped values. `auto` is the user's choice, not an engine's capability. */
export const DEFAULT_DICTATION_CONFIG: DictationConfig = {
  engine: 'omp',
  model: '',
  language: defaultDictationLanguage(typeof navigator === 'undefined' ? undefined : navigator.language),
  baseUrl: '',
  prompt: '',
  deviceId: '',
  minMs: DICTATION_MIN_MS,
  maxMs: DICTATION_MAX_MS,
};

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

/**
 * Normalise a stored object into a usable config.
 *
 * Unknown engines and languages fall back to the shipped ones rather than being
 * forwarded: the server passes the language tag to a recognizer, and forwarding
 * a value this build does not understand is how a decode silently switches
 * language.
 */
export function normalizeDictationConfig(raw: unknown): DictationConfig {
  const value = typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
  const engine = isDictationEngine(value.engine) ? value.engine : DEFAULT_DICTATION_CONFIG.engine;
  const language = isDictationLanguage(value.language)
    ? value.language
    : DEFAULT_DICTATION_CONFIG.language;
  return {
    engine,
    model: typeof value.model === 'string' ? value.model.trim().slice(0, 120) : '',
    language,
    baseUrl: normalizeBaseUrl(typeof value.baseUrl === 'string' ? value.baseUrl : '') ?? '',
    prompt: typeof value.prompt === 'string' ? value.prompt.slice(0, 800) : '',
    deviceId: typeof value.deviceId === 'string' ? value.deviceId.slice(0, 200) : '',
    minMs: clamp(value.minMs, DEFAULT_DICTATION_CONFIG.minMs, 100, 5000),
    maxMs: clamp(value.maxMs, DEFAULT_DICTATION_CONFIG.maxMs, 1000, 300_000),
  };
}

/** The base URL an engine actually uses: the setting, else the spec's default. */
export function resolveBaseUrl(engine: DictationEngine, baseUrl: string): string {
  return normalizeBaseUrl(baseUrl) ?? dictationEngine(engine).baseUrl;
}

/**
 * Join the transcription path onto a base URL.
 *
 * OpenAI wants `{base}/audio/transcriptions` where `base` already ends in
 * `/v1`; a server configured with the full path is accepted as-is so the field
 * is not a trap.
 */
export function transcriptionEndpoint(baseUrl: string): string {
  const base = (normalizeBaseUrl(baseUrl) ?? '').trim();
  if (!base) return '';
  return /\/audio\/transcriptions$/.test(base) ? base : `${base}/audio/transcriptions`;
}
