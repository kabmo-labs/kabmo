/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';

import { TtsEngineError } from '@/server/lib/tts/engines/adapter';
import { baseLanguage, resolveLocalLanguage, resolveLocalVoice } from '@/server/lib/tts/local-request';
import type { LocalTtsModelInfo } from '@/shared/lib/tts/local-models';

const model: LocalTtsModelInfo = {
  id: 'supertonic-3',
  label: 'Supertonic 3',
  arch: 'supertonic',
  languages: ['en', 'id', 'ja'],
  defaultLanguage: 'en',
  voices: 10,
  sampleRate: 44_100,
};

describe('language resolution', () => {
  test('BCP-47 becomes the ISO code these models take', () => {
    expect(baseLanguage('es-ES')).toBe('es');
    expect(baseLanguage('pt_BR')).toBe('pt');
    expect(baseLanguage('')).toBe('');
    expect(resolveLocalLanguage(model, 'id-ID')).toBe('id');
  });

  test('an empty setting uses the model default, not a guess', () => {
    expect(resolveLocalLanguage(model, '')).toBe('en');
    expect(resolveLocalLanguage({ ...model, defaultLanguage: 'id' }, '')).toBe('id');
  });

  test('a language the model does not declare is refused, with the list', () => {
    let thrown: unknown;
    try {
      resolveLocalLanguage(model, 'th');
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TtsEngineError);
    expect((thrown as TtsEngineError).message).toContain('does not speak TH');
    expect((thrown as TtsEngineError).message).toContain('en, id, ja');
    expect((thrown as TtsEngineError).retryable).toBe(false);
  });

  test('a model that declares nothing passes the code through', () => {
    expect(resolveLocalLanguage({ ...model, languages: [] }, 'th')).toBe('th');
  });
});

describe('voice resolution', () => {
  test('an index inside the speaker range is kept; empty means the first', () => {
    expect(resolveLocalVoice(10, '')).toBe(0);
    expect(resolveLocalVoice(10, '0')).toBe(0);
    expect(resolveLocalVoice(10, '9')).toBe(9);
  });

  test('an index outside the range names the range', () => {
    expect(() => resolveLocalVoice(10, '10')).toThrow(/voices 0–9/);
    expect(() => resolveLocalVoice(3, '7')).toThrow(/voices 0–2/);
    expect(() => resolveLocalVoice(10, 'female')).toThrow(/not one of them/);
    expect(() => resolveLocalVoice(10, '-1')).toThrow(/voices 0–9/);
  });
});
