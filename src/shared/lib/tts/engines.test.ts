/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';
import {
  clampTtsSpeed,
  isTtsEngine,
  resolveTtsModel,
  resolveTtsVoice,
  speechEndpoint,
  TTS_ENGINES,
  TTS_PRESETS,
  ttsEngine,
} from '@/shared/lib/tts/engines';

describe('TTS_ENGINES', () => {
  test('omp is the shipped default and needs no key', () => {
    expect(TTS_ENGINES[0].id).toBe('omp');
    expect(TTS_ENGINES[0].needsKey).toBe(false);
    expect(TTS_ENGINES.filter((engine) => !engine.needsKey).map((engine) => engine.id)).toEqual(['omp']);
  });

  test('every engine has a positive input budget and an ordered speed range', () => {
    for (const engine of TTS_ENGINES) {
      expect(engine.maxChars).toBeGreaterThan(0);
      expect(engine.speed.min).toBeLessThanOrEqual(engine.speed.max);
      expect(engine.label.length).toBeGreaterThan(0);
      expect(engine.where.length).toBeGreaterThan(0);
    }
  });

  test('only the OpenAI-compatible engine takes a user endpoint', () => {
    expect(TTS_ENGINES.filter((engine) => engine.editableBaseUrl).map((engine) => engine.id)).toEqual(['openai']);
  });

  test('an engine that offers voices resolves a default voice', () => {
    for (const engine of TTS_ENGINES) {
      if (engine.voices.length > 0 && engine.id !== 'deepgram') {
        expect(engine.defaultVoice.length).toBeGreaterThan(0);
      }
    }
  });

  test('only the engines that document language support expose it', () => {
    expect(TTS_ENGINES.filter((engine) => engine.language !== 'none').map((engine) => engine.id))
      .toEqual(['openai', 'elevenlabs', 'xai']);
    expect(ttsEngine('xai').language).toBe('required');
    expect(ttsEngine('omp').language).toBe('none');
  });

  test('only the OpenAI-compatible engine accepts a keyless endpoint', () => {
    expect(TTS_ENGINES.filter((engine) => engine.keyOptional).map((engine) => engine.id)).toEqual(['openai']);
  });

  test('presets name a model and a voice the engine understands', () => {
    for (const preset of TTS_PRESETS) {
      expect(preset.baseUrl).toMatch(/^https?:\/\//);
      expect(preset.model.length).toBeGreaterThan(0);
      expect(preset.voice.length).toBeGreaterThan(0);
    }
  });
});

describe('engine resolution', () => {
  test('an unknown id resolves to the local engine', () => {
    expect(ttsEngine('nope').id).toBe('omp');
    expect(isTtsEngine('nope')).toBe(false);
    expect(isTtsEngine('xai')).toBe(true);
  });

  test('model and voice fall back to the engine default', () => {
    expect(resolveTtsModel('openai', '')).toBe('gpt-4o-mini-tts');
    expect(resolveTtsModel('openai', 'tts-1')).toBe('tts-1');
    expect(resolveTtsVoice('xai', '')).toBe('eve');
  });

  test('speed is clamped per engine', () => {
    expect(clampTtsSpeed('omp', 2)).toBe(1.3);
    expect(clampTtsSpeed('openai', 9)).toBe(4);
    expect(clampTtsSpeed('deepgram', Number.NaN)).toBe(1);
  });

  test('the speech path is joined once', () => {
    expect(speechEndpoint('https://api.openai.com/v1')).toBe('https://api.openai.com/v1/audio/speech');
    expect(speechEndpoint('https://api.openai.com/v1/audio/speech')).toBe('https://api.openai.com/v1/audio/speech');
    expect(speechEndpoint('')).toBe('');
  });
});
