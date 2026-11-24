/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The speech preference, its shipped values, and the clamps every reader
 * applies.
 *
 * One module because the settings form, the client player and the server route
 * all need the same answer to "what does an absent or hostile value mean?".
 * The stored object is untrusted (a direct API write, a downgrade, a hand-edited
 * row), so the clamps live here rather than in each caller.
 *
 * The API keys are deliberately NOT part of this object: the settings blob is
 * injected into the page, so a key stored here would be readable by any script
 * on the origin. They live in `~/.kabmo/tts.json` (0600) and are written by
 * their own route.
 */

import {
  clampTtsSpeed,
  isTtsEngine,
  resolveTtsModel,
  resolveTtsVoice,
  ttsEngine,
  type TtsEngine,
} from '@/shared/lib/tts/engines';
import { normalizeBaseUrl } from '@/shared/lib/net/base-url';

export interface TtsConfig {
  engine: TtsEngine;
  /** '' means "the engine's default model". */
  model: string;
  /** '' means "the engine's default voice" (omp: its own `tts.localVoice`). */
  voice: string;
  /** Speaking rate; clamped per engine at use time. */
  speed: number;
  /** '' means "the engine's default endpoint". Only the openai engine reads it. */
  baseUrl: string;
  /** BCP-47 tag for engines that take one; '' means the engine's default. */
  language: string;
  /** Speak the final answer of a run as soon as it settles. */
  autoplay: boolean;
}

/** Shipped values. `omp` is the user's own install: no key, no network. */
export const DEFAULT_TTS_CONFIG: TtsConfig = {
  engine: 'omp',
  model: '',
  voice: '',
  speed: 1,
  baseUrl: '',
  language: '',
  autoplay: false,
};

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/**
 * Normalise a stored object into a usable config.
 *
 * Unknown engines fall back to the shipped one rather than being forwarded: the
 * server spends money on the engine it hears about, so a value this build does
 * not understand must not become a request.
 */
export function normalizeTtsConfig(raw: unknown): TtsConfig {
  const value = typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
  const engine = isTtsEngine(value.engine) ? value.engine : DEFAULT_TTS_CONFIG.engine;
  return {
    engine,
    model: text(value.model, 120),
    voice: text(value.voice, 120),
    speed: clampTtsSpeed(engine, typeof value.speed === 'number' ? value.speed : Number(value.speed)),
    baseUrl: normalizeBaseUrl(text(value.baseUrl, 500)) ?? '',
    language: text(value.language, 35),
    autoplay: value.autoplay === true,
  };
}

/** The endpoint an engine actually uses: the setting, else the spec's default. */
export function resolveTtsBaseUrl(engine: TtsEngine, baseUrl: string): string {
  return normalizeBaseUrl(baseUrl) ?? ttsEngine(engine).baseUrl;
}

/** Everything a synthesis request needs, with defaults applied. */
export function resolveTtsRequest(config: TtsConfig): {
  engine: TtsEngine;
  model: string;
  voice: string;
  speed: number;
  baseUrl: string;
  language: string;
} {
  const spec = ttsEngine(config.engine);
  return {
    engine: config.engine,
    model: resolveTtsModel(config.engine, config.model),
    voice: resolveTtsVoice(config.engine, config.voice),
    speed: clampTtsSpeed(config.engine, config.speed),
    baseUrl: spec.editableBaseUrl ? resolveTtsBaseUrl(config.engine, config.baseUrl) : spec.baseUrl,
    language: config.language.trim() || (spec.supportsLanguage ? 'auto' : ''),
  };
}
