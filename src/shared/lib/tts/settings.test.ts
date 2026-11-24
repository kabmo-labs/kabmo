/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_TTS_CONFIG,
  normalizeTtsConfig,
  resolveTtsRequest,
} from '@/shared/lib/tts/settings';

describe('normalizeTtsConfig', () => {
  test('an absent value is the shipped config', () => {
    expect(normalizeTtsConfig(undefined)).toEqual(DEFAULT_TTS_CONFIG);
  });

  test('an unknown engine falls back instead of being forwarded', () => {
    expect(normalizeTtsConfig({ engine: 'sovits' }).engine).toBe('omp');
  });

  test('speed is clamped to the engine it was chosen for', () => {
    expect(normalizeTtsConfig({ engine: 'omp', speed: 9 }).speed).toBe(1.3);
    expect(normalizeTtsConfig({ engine: 'xai', speed: 0 }).speed).toBe(0.7);
    expect(normalizeTtsConfig({ engine: 'openai', speed: 2.5 }).speed).toBe(2.5);
  });

  test('a base URL that is not http(s) is dropped, not stored', () => {
    expect(normalizeTtsConfig({ engine: 'openai', baseUrl: 'file:///etc/passwd' }).baseUrl).toBe('');
    expect(normalizeTtsConfig({ engine: 'openai', baseUrl: 'https://x/v1/' }).baseUrl).toBe('https://x/v1');
  });

  test('autoplay is strictly boolean', () => {
    expect(normalizeTtsConfig({ autoplay: 'yes' }).autoplay).toBe(false);
    expect(normalizeTtsConfig({ autoplay: true }).autoplay).toBe(true);
  });
});

describe('resolveTtsRequest', () => {
  test('applies the engine defaults for an empty model and voice', () => {
    const request = resolveTtsRequest({ ...DEFAULT_TTS_CONFIG, engine: 'openai' });
    expect(request.model).toBe('gpt-4o-mini-tts');
    expect(request.voice).toBe('marin');
    expect(request.baseUrl).toBe('https://api.openai.com/v1');
  });

  test('xAI always gets a language, because its API requires one', () => {
    const request = resolveTtsRequest({ ...DEFAULT_TTS_CONFIG, engine: 'xai' });
    expect(request.language).toBe('auto');
  });

  test('an engine with a fixed host ignores a stored base URL', () => {
    const request = resolveTtsRequest({ ...DEFAULT_TTS_CONFIG, engine: 'deepgram', baseUrl: 'https://evil.example' });
    expect(request.baseUrl).toBe('https://api.deepgram.com');
  });
});
