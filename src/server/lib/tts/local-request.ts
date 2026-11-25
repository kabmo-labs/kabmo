/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The two choices a local request carries — a language and a voice — and the
 * refusals that keep them honest.
 *
 * Both rules exist because the runtime does not enforce either: it validates the
 * language code against its own 32-code list rather than the loaded model (the
 * English-only Supertonic v1 bundle synthesizes Indonesian text on request), and
 * it clamps an out-of-range speaker id to 0 instead of reporting it. Reading an
 * answer in the wrong language or the wrong person is the failure both refusals
 * prevent, so the message names what IS available.
 */

import { TtsEngineError } from '@/server/lib/tts/engines/adapter';
import type { LocalTtsModelInfo } from '@/shared/lib/tts/local-models';

/** `es-ES` → `es`; '' stays ''. These models take ISO 639-1. */
export function baseLanguage(language: string): string {
  return language.trim().toLowerCase().split(/[-_]/)[0] ?? '';
}

/**
 * The language a request will actually synthesize.
 *
 * A model that declares languages refuses anything else. A model that declares
 * nothing passes the code through — and the settings page says it declared
 * nothing, so the choice is visibly the user's.
 */
export function resolveLocalLanguage(model: LocalTtsModelInfo, language: string): string {
  const requested = baseLanguage(language);
  const declared = model.languages;
  if (!requested) return model.defaultLanguage || declared[0] || 'en';
  if (declared.length === 0) return requested;
  if (declared.includes(requested)) return requested;
  throw new TtsEngineError(
    `${model.label} does not speak ${requested.toUpperCase()}. It speaks: ${declared.join(', ')}.`,
    false,
  );
}

/** A speaker id inside the model's range, or a refusal naming the range. */
export function resolveLocalVoice(voices: number, voice: string): number {
  const text = voice.trim();
  if (!text) return 0;
  const sid = Number(text);
  if (!Number.isInteger(sid) || sid < 0 || (voices > 0 && sid >= voices)) {
    throw new TtsEngineError(
      voices > 0
        ? `That model has voices 0–${voices - 1}; "${text}" is not one of them.`
        : `"${text}" is not a voice id.`,
      false,
    );
  }
  return sid;
}
