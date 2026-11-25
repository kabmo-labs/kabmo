/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';

import {
  LOCAL_LANGUAGE_LABELS,
  LOCAL_TTS_CATALOG,
  SUPERTONIC_VOICE_LABELS,
  catalogModel,
  describeLocalModel,
  formatModelSize,
  localLanguageOptions,
  localVoiceLabel,
  localVoiceOptions,
} from '@/shared/lib/tts/local-models';

const supertonic = LOCAL_TTS_CATALOG[0]!;

describe('local model catalog', () => {
  test('the shipped model speaks Indonesian and states its voices', () => {
    expect(supertonic.id).toBe('supertonic-3');
    expect(supertonic.languages).toContain('id');
    expect(supertonic.defaultLanguage).toBe('en');
    expect(supertonic.voices).toBe(SUPERTONIC_VOICE_LABELS.length);
    expect(catalogModel('supertonic-3')).toBe(supertonic);
    expect(catalogModel('nope')).toBeUndefined();
  });

  test('every declared Supertonic language has a label', () => {
    for (const code of supertonic.languages) {
      expect(LOCAL_LANGUAGE_LABELS[code]).toBeString();
    }
    expect(supertonic.languages).toHaveLength(31);
  });

  test('a model with languages offers only those; one without offers every known code', () => {
    expect(localLanguageOptions(supertonic).map((entry) => entry.id)).toContain('id');
    expect(localLanguageOptions(supertonic)).toHaveLength(31);
    expect(localLanguageOptions({ ...supertonic, languages: ['en', 'id'] }).map((entry) => entry.id))
      .toEqual(['en', 'id']);
    expect(localLanguageOptions({ ...supertonic, languages: [] })).toHaveLength(
      Object.keys(LOCAL_LANGUAGE_LABELS).length,
    );
  });

  test('a voice is its documented name, and an unnamed speaker is still numbered', () => {
    expect(localVoiceLabel(supertonic, 0)).toBe('Female 1');
    expect(localVoiceLabel(supertonic, 9)).toBe('Male 5');
    expect(localVoiceLabel({ ...supertonic, voiceLabels: undefined }, 3)).toBe('Voice 3');
  });

  test('voice options cover the probed speaker count, or one default when unknown', () => {
    expect(localVoiceOptions({ ...supertonic, voices: 2 }).map((entry) => entry.label))
      .toEqual(['Female 1', 'Female 2']);
    expect(localVoiceOptions({ ...supertonic, voices: 0 })).toEqual([{ id: '0', label: 'Default voice' }]);
    expect(localVoiceOptions(null)).toEqual([{ id: '0', label: 'Default voice' }]);
  });

  test('the one-line description states languages, voices and size', () => {
    expect(describeLocalModel(supertonic)).toBe('31 languages · 10 voices · 146 MB');
    expect(describeLocalModel({ ...supertonic, languages: [], voices: 0, sizeBytes: undefined }))
      .toBe('languages not declared');
    expect(formatModelSize(1_500_000_000)).toBe('1.5 GB');
    expect(formatModelSize(0)).toBe('');
  });
});
