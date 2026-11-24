/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which language the recognizer is told the utterance is in.
 *
 * This is the setting that decides whether Indonesian transcribes at all.
 * Measured on whisper-base (q8, the tier the local worker loads) with 16 kHz
 * synthetic speech: an Indonesian clip decoded with `en` — or with no language
 * at all — came back as English nonsense, and the same clip decoded with `id`
 * came back correct. transformers.js does not "auto-detect" when the field is
 * missing; its Whisper pipeline logs `No language specified - defaulting to
 * English (en)` and pins `en`. The opposite also holds: an English clip decoded
 * with `id` is mangled. There is no safe single default, which is why the value
 * is explicit and the browser's own language only picks the FIRST default.
 */

import { dictationEngine, type DictationEngine } from '@/shared/lib/dictation/engines';

export type DictationLanguage = 'id' | 'en' | 'auto';

export interface DictationLanguageOption {
  id: DictationLanguage;
  label: string;
  /** The BCP-47/ISO-639-1 tag sent, or undefined for "let the engine detect". */
  tag?: string;
  note: string;
}

export const DICTATION_LANGUAGES: readonly DictationLanguageOption[] = [
  {
    id: 'id',
    label: 'Indonesian',
    tag: 'id',
    note: 'Sent as “id”. Required for Indonesian speech on every engine that takes a hint.',
  },
  {
    id: 'en',
    label: 'English',
    tag: 'en',
    note: 'Sent as “en”. Required for English speech on the local engine.',
  },
  {
    id: 'auto',
    label: 'Detect automatically',
    note: 'Hosted engines detect per utterance; the local engine cannot, so it falls back to the language in omp’s config (English by default).',
  },
];

export function isDictationLanguage(value: unknown): value is DictationLanguage {
  return value === 'id' || value === 'en' || value === 'auto';
}

/**
 * The first-run default: the browser's own language decides between the two
 * supported ones. A device set to Indonesian starts dictating in Indonesian
 * instead of silently transcribing it as English.
 */
export function defaultDictationLanguage(navigatorLanguage?: string): 'id' | 'en' {
  const tag = (navigatorLanguage ?? '').trim().toLowerCase();
  return tag.startsWith('id') ? 'id' : 'en';
}

/**
 * The tag to send, or undefined to let the engine detect.
 *
 * `ompLanguage` is omp's own `stt.language`, used only for the local engine in
 * `auto` mode — the one place a stored value can stand in for a missing hint.
 * A tag that is not a plain language code is ignored rather than forwarded.
 */
export function resolveDictationTag(
  engine: DictationEngine,
  language: DictationLanguage | undefined,
  ompLanguage?: string,
): string | undefined {
  const selected = language ?? 'auto';
  const spec = dictationEngine(engine);

  if (selected !== 'auto') return selected;

  if (spec.language === 'detect') return undefined;

  // The local engine treats a missing language as English. Sending the tag
  // explicitly is what makes that visible instead of implied, and omp's own
  // configured language is the only user intent available here.
  const configured = (ompLanguage ?? '').trim();
  return /^[a-z]{2,3}$/.test(configured) ? configured : 'en';
}
