/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The stored dictation preference: what an absent, partial or hostile value
 * means, and where the endpoint is joined.
 *
 * Every case here is a value the server acts on — a base URL it fetches, a
 * language it forwards to a recognizer, a duration that decides whether an
 * utterance is refused — so a wrong default is a silent behaviour change rather
 * than a visible crash.
 */

import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_DICTATION_CONFIG,
  normalizeBaseUrl,
  normalizeDictationConfig,
  resolveBaseUrl,
  transcriptionEndpoint,
} from '@/shared/lib/dictation/settings';

describe('normalizeBaseUrl', () => {
  test('accepts http(s) and strips trailing slashes', () => {
    expect(normalizeBaseUrl('https://api.groq.com/openai/v1/')).toBe('https://api.groq.com/openai/v1');
    expect(normalizeBaseUrl('  http://127.0.0.1:8000/v1  ')).toBe('http://127.0.0.1:8000/v1');
  });

  test('refuses a scheme the server would not fetch', () => {
    expect(normalizeBaseUrl('file:///etc/passwd')).toBeNull();
    expect(normalizeBaseUrl('ftp://example.com')).toBeNull();
    expect(normalizeBaseUrl('not a url')).toBeNull();
    expect(normalizeBaseUrl('')).toBeNull();
  });

  test('refuses embedded credentials, which would be forwarded silently', () => {
    expect(normalizeBaseUrl('https://user:pass@example.com/v1')).toBeNull();
  });
});

describe('transcriptionEndpoint', () => {
  test('joins the documented path onto a /v1 base', () => {
    expect(transcriptionEndpoint('https://api.openai.com/v1')).toBe(
      'https://api.openai.com/v1/audio/transcriptions',
    );
  });

  test('a base that already names the full path is not doubled', () => {
    expect(transcriptionEndpoint('http://127.0.0.1:8000/v1/audio/transcriptions')).toBe(
      'http://127.0.0.1:8000/v1/audio/transcriptions',
    );
  });

  test('an unusable base yields no endpoint rather than a relative URL', () => {
    expect(transcriptionEndpoint('file:///tmp')).toBe('');
    expect(transcriptionEndpoint('')).toBe('');
  });
});

describe('resolveBaseUrl', () => {
  test('an empty setting falls back to the engine default', () => {
    expect(resolveBaseUrl('openai', '')).toBe('https://api.openai.com/v1');
  });

  test('a configured value wins, normalised', () => {
    expect(resolveBaseUrl('openai', 'https://api.groq.com/openai/v1/')).toBe(
      'https://api.groq.com/openai/v1',
    );
  });
});

describe('normalizeDictationConfig', () => {
  test('an absent object yields the shipped defaults', () => {
    expect(normalizeDictationConfig(undefined)).toEqual(DEFAULT_DICTATION_CONFIG);
    expect(normalizeDictationConfig('nope')).toEqual(DEFAULT_DICTATION_CONFIG);
    expect(normalizeDictationConfig([])).toEqual(DEFAULT_DICTATION_CONFIG);
  });

  test('an unknown engine and language fall back instead of being forwarded', () => {
    const config = normalizeDictationConfig({ engine: 'whisper-cli', language: 'de' });
    expect(config.engine).toBe(DEFAULT_DICTATION_CONFIG.engine);
    expect(config.language).toBe(DEFAULT_DICTATION_CONFIG.language);
  });

  test('a known engine and language survive', () => {
    const config = normalizeDictationConfig({ engine: 'openai', language: 'id' });
    expect(config.engine).toBe('openai');
    expect(config.language).toBe('id');
  });

  test('durations are clamped into what the capture path can produce', () => {
    expect(normalizeDictationConfig({ minMs: 5 }).minMs).toBe(100);
    expect(normalizeDictationConfig({ minMs: 99_999 }).minMs).toBe(5000);
    expect(normalizeDictationConfig({ maxMs: 10 }).maxMs).toBe(1000);
    expect(normalizeDictationConfig({ maxMs: 10_000_000 }).maxMs).toBe(300_000);
    expect(normalizeDictationConfig({ minMs: 'abc' }).minMs).toBe(DEFAULT_DICTATION_CONFIG.minMs);
  });

  test('an unusable base URL is stored as empty, so the engine default applies', () => {
    expect(normalizeDictationConfig({ baseUrl: 'file:///etc/passwd' }).baseUrl).toBe('');
    expect(normalizeDictationConfig({ baseUrl: 'https://api.groq.com/openai/v1/' }).baseUrl).toBe(
      'https://api.groq.com/openai/v1',
    );
  });

  test('the model is trimmed and bounded, and the prompt is bounded', () => {
    expect(normalizeDictationConfig({ model: '  whisper-1  ' }).model).toBe('whisper-1');
    expect(normalizeDictationConfig({ model: 'x'.repeat(500) }).model).toHaveLength(120);
    expect(normalizeDictationConfig({ prompt: 'p'.repeat(5000) }).prompt).toHaveLength(800);
  });
});
