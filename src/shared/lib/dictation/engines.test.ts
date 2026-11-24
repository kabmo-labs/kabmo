/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The engine catalog and the socket path built from it.
 *
 * The catalog is what the settings page draws and what the server dispatches on,
 * so the facts pinned here are the ones a new engine can break silently: every
 * engine has a default model that its own list contains, the local engine is the
 * only one that needs no key, and the path/query the client builds is the one the
 * server decodes.
 */

import { describe, expect, test } from 'bun:test';
import {
  DICTATION_ENGINES,
  DICTATION_PRESETS,
  dictationEngine,
  isDictationEngine,
  resolveDictationModel,
} from '@/shared/lib/dictation/engines';
import {
  decodeDictationQuery,
  dictationSocketPath,
} from '@/shared/lib/dictation/protocol';
import { STT_MODELS } from '@/shared/lib/dictation/models';

describe('DICTATION_ENGINES', () => {
  test('the local engine is the shipped default and needs no key', () => {
    expect(DICTATION_ENGINES[0].id).toBe('omp');
    expect(DICTATION_ENGINES[0].needsKey).toBe(false);
    expect(DICTATION_ENGINES.filter((engine) => !engine.needsKey).map((engine) => engine.id)).toEqual(['omp']);
  });

  test('every engine default model is one of its own options', () => {
    for (const engine of DICTATION_ENGINES) {
      expect(engine.models.map((model) => model.id)).toContain(engine.defaultModel);
    }
  });

  test('the local model list is omp’s registry, not a second copy', () => {
    const local = dictationEngine('omp');
    expect(local.models.map((model) => model.id)).toEqual(STT_MODELS.map((model) => model.key));
  });

  test('only the [OI]-compatible engine has an editable endpoint', () => {
    const editable = DICTATION_ENGINES.filter((engine) => engine.editableBaseUrl).map((engine) => engine.id);
    expect(editable).toEqual(['openai']);
  });

  test('the local engine is the one that cannot detect a language', () => {
    const hinting = DICTATION_ENGINES.filter((engine) => engine.language === 'hint').map((engine) => engine.id);
    expect(hinting).toEqual(['omp']);
  });

  test('the guard rejects an unknown id', () => {
    expect(isDictationEngine('omp')).toBe(true);
    expect(isDictationEngine('whisper.cpp')).toBe(false);
    expect(isDictationEngine(undefined)).toBe(false);
  });

  test('an unknown engine id resolves to the local spec rather than throwing', () => {
    expect(dictationEngine('nope').id).toBe('omp');
  });
});

describe('resolveDictationModel', () => {
  test('an empty setting uses the engine default', () => {
    expect(resolveDictationModel('openai', '')).toBe('gpt-4o-mini-transcribe');
    expect(resolveDictationModel('omp', undefined)).toBe('whisper-base');
  });

  test('a configured model wins, trimmed', () => {
    expect(resolveDictationModel('openai', '  whisper-1 ')).toBe('whisper-1');
  });
});

describe('DICTATION_PRESETS', () => {
  test('every preset names a model its engine can serve', () => {
    const openai = dictationEngine('openai').models.map((model) => model.id);
    for (const preset of DICTATION_PRESETS) {
      expect(openai).toContain(preset.model);
      expect(preset.baseUrl.startsWith('http')).toBe(true);
    }
  });

  test('the local preset needs no key, which is why it exists', () => {
    expect(DICTATION_PRESETS.find((preset) => preset.id === 'local')?.baseUrl).toContain('127.0.0.1');
  });
});

describe('dictationSocketPath / decodeDictationQuery', () => {
  test('an empty request is the bare path', () => {
    expect(dictationSocketPath()).toBe('/api/dictation/ws');
    expect(dictationSocketPath({})).toBe('/api/dictation/ws');
  });

  test('the client’s path decodes back to the same request', () => {
    const path = dictationSocketPath({ engine: 'openai', language: 'id', model: 'whisper-1' });
    const query = Object.fromEntries(new URL(path, 'http://localhost').searchParams);
    expect(decodeDictationQuery(query)).toEqual({
      engine: 'openai',
      language: 'id',
      model: 'whisper-1',
    });
  });

  test('an unknown engine or language is dropped, never forwarded', () => {
    expect(decodeDictationQuery({ engine: 'whisper.cpp', language: 'de', model: 'x' })).toEqual({ model: 'x' });
  });

  test('a blank model is omitted', () => {
    expect(decodeDictationQuery({ engine: 'omp', model: '   ' })).toEqual({ engine: 'omp' });
  });
});
