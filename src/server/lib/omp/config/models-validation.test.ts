/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Validation of the provider shapes the settings UI can now write.
 *
 * omp's failure mode is what makes these worth locking: one schema violation
 * anywhere in `models.yml` makes it disable EVERY custom provider at once, so a
 * dialect or auth value the UI let through takes the whole registry down. Each
 * case below was verified against omp 18.3.0 by loading the document.
 */

import { describe, expect, test } from 'bun:test';

import { validateModelsDocument } from '@/server/lib/omp/config/models-validation';

describe('validateModelsDocument — dialect fields', () => {
  test('accepts every api omp ships', () => {
    const apis = [
      'openai-completions', 'openai-responses', 'openai-codex-responses',
      'azure-openai-responses', 'anthropic-messages', 'bedrock-converse-stream',
      'google-generative-ai', 'google-gemini-cli', 'google-vertex',
      'openrouter-decisions', 'typesafe',
    ];
    for (const api of apis) {
      expect(validateModelsDocument({ providers: { p: { api, baseUrl: 'https://x/v1', apiKey: 'k' } } }))
        .toEqual([]);
    }
  });

  test('rejects an api omp does not know', () => {
    const errors = validateModelsDocument({
      providers: { p: { api: 'openai-completions-v2', baseUrl: 'https://x/v1', apiKey: 'k' } },
    });
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('unknown "api" value');
  });

  test('accepts the three auth modes and rejects anything else', () => {
    for (const auth of ['apiKey', 'none', 'oauth']) {
      expect(validateModelsDocument({ providers: { p: { baseUrl: 'https://x/v1', auth } } })).toEqual([]);
    }
    const errors = validateModelsDocument({ providers: { p: { baseUrl: 'https://x/v1', auth: 'bearer' } } });
    expect(errors.some((error) => error.includes('unknown "auth" value'))).toBe(true);
  });

  test('a keyless provider needs no apiKey even with models', () => {
    // This is the shape a local server is registered with; demanding a key here
    // is what made every keyless provider look unconfigured.
    expect(validateModelsDocument({
      providers: { local: { baseUrl: 'http://127.0.0.1:11434/v1', api: 'openai-responses', auth: 'none', models: [{ id: 'm' }] } },
    })).toEqual([]);
  });

  test('a models-carrying provider without auth still requires a key', () => {
    const errors = validateModelsDocument({
      providers: { p: { baseUrl: 'https://x/v1', api: 'openai-completions', models: [{ id: 'm' }] } },
    });
    expect(errors.some((error) => error.includes('"apiKey" is required'))).toBe(true);
  });
});

describe('validateModelsDocument — discovery', () => {
  test('accepts a discovery shell with no models at all', () => {
    // A discovery provider legitimately carries an empty model list; omp lists
    // the models itself.
    expect(validateModelsDocument({
      providers: { disc: { baseUrl: 'http://127.0.0.1:11434', api: 'openai-responses', discovery: { type: 'ollama' } } },
    })).toEqual([]);
  });

  test('accepts every discovery type omp ships', () => {
    for (const type of ['ollama', 'llama.cpp', 'lm-studio', 'openai-models-list', 'litellm', 'apple-foundation-models']) {
      expect(validateModelsDocument({
        providers: { p: { baseUrl: 'https://x/v1', api: 'openai-completions', discovery: { type } } },
      })).toEqual([]);
    }
    expect(validateModelsDocument({
      providers: { p: { baseUrl: 'https://x/v1', api: 'openai-completions', discovery: { type: 'proxy' } } },
    })).toEqual([]);
  });

  test('rejects an unknown discovery type', () => {
    const errors = validateModelsDocument({
      providers: { p: { baseUrl: 'https://x/v1', api: 'openai-completions', discovery: { type: 'vllm' } } },
    });
    expect(errors.some((error) => error.includes('unknown discovery type'))).toBe(true);
  });

  test('discovery without a provider api is refused, except for proxy', () => {
    const withoutApi = validateModelsDocument({
      providers: { p: { baseUrl: 'https://x/v1', discovery: { type: 'openai-models-list' } } },
    });
    expect(withoutApi.some((error) => error.includes('"api" is required when discovery'))).toBe(true);

    const proxy = validateModelsDocument({
      providers: { p: { baseUrl: 'https://x/v1', discovery: { type: 'proxy' } } },
    });
    expect(proxy).toEqual([]);
  });

  test('injectV1 is only allowed on openai-models-list', () => {
    const errors = validateModelsDocument({
      providers: { p: { baseUrl: 'https://x/v1', api: 'openai-completions', discovery: { type: 'ollama', injectV1: false } } },
    });
    expect(errors.some((error) => error.includes('injectV1 only on'))).toBe(true);
  });
});

describe('validateModelsDocument — override-only providers', () => {
  test('a bare endpoint override for a bundled provider is valid', () => {
    // The documented way to point a bundled provider at a proxy: no models,
    // just an endpoint. omp then keeps serving its own model list.
    expect(validateModelsDocument({ providers: { anthropic: { baseUrl: 'https://proxy.example.com' } } }))
      .toEqual([]);
  });

  test('a provider with no configuration at all is still refused', () => {
    const errors = validateModelsDocument({ providers: { empty: {} } });
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('must specify');
  });

  test('an empty apiKey is refused — omp rejects it', () => {
    const errors = validateModelsDocument({ providers: { p: { baseUrl: 'https://x/v1', apiKey: '' } } });
    expect(errors.some((error) => error.includes('"apiKey" must be a non-empty string'))).toBe(true);
  });

  test('a map-form models entry is refused as a file-breaking shape', () => {
    const errors = validateModelsDocument({
      providers: { p: { baseUrl: 'https://x/v1', apiKey: 'k', models: { a: {} } } },
    });
    expect(errors).toEqual(['Provider p: "models" must be an array']);
  });
});
