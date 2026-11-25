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
  test('omp is the shipped default, and both on-machine engines need no key', () => {
    expect(TTS_ENGINES[0].id).toBe('omp');
    expect(TTS_ENGINES[0].needsKey).toBe(false);
    expect(TTS_ENGINES.filter((engine) => !engine.needsKey).map((engine) => engine.id)).toEqual(['omp', 'local']);
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
      .toEqual(['local', 'openai', 'elevenlabs', 'xai', 'gemini']);
    expect(ttsEngine('xai').language).toBe('required');
    expect(ttsEngine('gemini').language).toBe('auto');
    // The ONNX engine sends a language per request; omp has no such channel.
    expect(ttsEngine('local').language).toBe('parameter');
    expect(ttsEngine('omp').language).toBe('none');
  });

  test('Deepgram offers Flux voices whose id carries the language', () => {
    const ids = ttsEngine('deepgram').models.map((model) => model.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('flux-dewi-id');
    for (const id of ids.filter((entry) => entry.startsWith('flux-'))) {
      expect(id).toMatch(/^flux-[a-z]+-[a-z]{2}$/);
    }
  });

  test('Deepgram speed is the range both endpoints accept', () => {
    // Measured: Aura refuses 0.5 and 1.55; Flux refuses the same edges.
    expect(clampTtsSpeed('deepgram', 2)).toBe(1.5);
    expect(clampTtsSpeed('deepgram', 0.1)).toBe(0.7);
  });

  test('the ONNX engine is a machine-local engine with a real speed range', () => {
    expect(ttsEngine('local').where).toContain('never leaves this machine');
    expect(ttsEngine('local').needsKey).toBe(false);
    expect(ttsEngine('local').editableBaseUrl).toBe(false);
    expect(clampTtsSpeed('local', 9)).toBe(2);
    expect(clampTtsSpeed('local', 0.1)).toBe(0.7);
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
