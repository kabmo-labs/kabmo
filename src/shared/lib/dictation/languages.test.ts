/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The language decision, pinned because every branch of it is a silent one.
 *
 * Measured on whisper-base (q8, the tier the local worker loads) with 16 kHz
 * synthetic speech: an Indonesian clip decoded with `en` — or with no language at
 * all, because the local pipeline defaults to English — came back as English
 * words; the same clip decoded with `id` came back correct. An English clip
 * decoded with `id` is mangled the same way. So the two facts a regression here
 * would destroy are: `auto` on the LOCAL engine still sends a concrete tag, and
 * a tag this build does not understand is never forwarded to a recognizer.
 */

import { describe, expect, test } from 'bun:test';
import {
  DICTATION_LANGUAGES,
  defaultDictationLanguage,
  isDictationLanguage,
  resolveDictationTag,
} from '@/shared/lib/dictation/languages';

describe('resolveDictationTag', () => {
  test('an explicit choice is sent as its ISO-639-1 tag', () => {
    expect(resolveDictationTag('openai', 'id')).toBe('id');
    expect(resolveDictationTag('openai', 'en')).toBe('en');
    expect(resolveDictationTag('omp', 'id')).toBe('id');
  });

  test('auto on a detecting engine sends no tag, so the provider decides', () => {
    expect(resolveDictationTag('openai', 'auto')).toBeUndefined();
    expect(resolveDictationTag('deepgram', 'auto')).toBeUndefined();
    expect(resolveDictationTag('elevenlabs', 'auto')).toBeUndefined();
  });

  test('auto on the LOCAL engine sends a concrete tag — a missing one means English', () => {
    // transformers.js logs "No language specified - defaulting to English (en)".
    // Sending the tag explicitly is what makes that behaviour stated instead of
    // implied, and omp's own configured value is the only stored intent there is.
    expect(resolveDictationTag('omp', 'auto')).toBe('en');
    expect(resolveDictationTag('omp', 'auto', 'id')).toBe('id');
  });

  test('a junk omp value falls back to English rather than being forwarded', () => {
    expect(resolveDictationTag('omp', 'auto', 'not a language tag!')).toBe('en');
    expect(resolveDictationTag('omp', 'auto', '')).toBe('en');
  });

  test('an absent language behaves like auto', () => {
    expect(resolveDictationTag('openai', undefined)).toBeUndefined();
    expect(resolveDictationTag('omp', undefined)).toBe('en');
  });
});

describe('the language list', () => {
  test('Indonesian is first, because it is the case that was broken', () => {
    expect(DICTATION_LANGUAGES[0].id).toBe('id');
    expect(DICTATION_LANGUAGES.map((option) => option.id)).toEqual(['id', 'en', 'auto']);
  });

  test('only the two concrete languages carry a tag', () => {
    const tags = DICTATION_LANGUAGES.filter((option) => option.tag).map((option) => option.tag);
    expect(tags).toEqual(['id', 'en']);
  });

  test('the guard rejects everything else', () => {
    expect(isDictationLanguage('id')).toBe(true);
    expect(isDictationLanguage('auto')).toBe(true);
    expect(isDictationLanguage('de')).toBe(false);
    expect(isDictationLanguage(undefined)).toBe(false);
  });
});

describe('defaultDictationLanguage', () => {
  test('an Indonesian device starts in Indonesian', () => {
    expect(defaultDictationLanguage('id-ID')).toBe('id');
    expect(defaultDictationLanguage('ID')).toBe('id');
  });

  test('every other device starts in English', () => {
    expect(defaultDictationLanguage('en-US')).toBe('en');
    expect(defaultDictationLanguage('ja-JP')).toBe('en');
    expect(defaultDictationLanguage(undefined)).toBe('en');
  });
});
