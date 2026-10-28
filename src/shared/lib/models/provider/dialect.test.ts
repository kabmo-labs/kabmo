/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The provider dialect table is the single place the server (which validates
 * and writes `models.yml`) and the client (which offers the picker options)
 * agree on what omp accepts. Every value here is a wire contract with a silent
 * failure mode: an `api` omp does not know makes omp disable EVERY custom
 * provider in the file at once, a masked key persisted as if real makes a
 * provider look configured while it cannot authenticate, and a wrong
 * `providerEmptyReason`/`providerFetchBlockReason` either hides a working
 * provider behind "no models" or freezes a fetched snapshot beside omp's own
 * live list. These tests pin the accepted vocabulary, the guards (including
 * near-misses and non-strings), the URL inference rules, and the full
 * precedence of both reason functions.
 */

import { describe, expect, test } from 'bun:test';

import {
  PROVIDER_APIS,
  PROVIDER_API_LABELS,
  PROVIDER_AUTH_MODES,
  PROVIDER_DISCOVERY_TYPES,
  PROVIDER_THINKING_EFFORTS,
  inferProviderApi,
  isMaskedApiKey,
  isOmpProviderApi,
  isProviderAuthMode,
  isProviderDiscoveryType,
  isProviderThinkingEffort,
  providerEmptyReason,
  providerFetchBlockReason,
} from '@/shared/lib/models/provider/dialect';

describe('dialect vocabulary', () => {
  test('PROVIDER_APIS is exactly omp’s ApiSchema order', () => {
    expect([...PROVIDER_APIS]).toEqual([
      'openai-completions',
      'openai-responses',
      'openai-codex-responses',
      'azure-openai-responses',
      'anthropic-messages',
      'bedrock-converse-stream',
      'google-generative-ai',
      'google-gemini-cli',
      'google-vertex',
      'openrouter-decisions',
      'openai-decisions',
      'workers-ai-systemone',
      'typesafe',
    ]);
  });

  test('every api has a non-empty picker label', () => {
    for (const api of PROVIDER_APIS) {
      expect(PROVIDER_API_LABELS[api], api).toBeTruthy();
    }
  });

  test('effort ladder excludes "off" and is lowest-first', () => {
    // `off` is a per-turn choice, not a declared capability: omp rejects it
    // inside `thinking.efforts`.
    expect([...PROVIDER_THINKING_EFFORTS]).toEqual(['minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
    expect(PROVIDER_THINKING_EFFORTS as readonly string[]).not.toContain('off');
  });

  test('auth modes and discovery types match omp’s schemas', () => {
    expect(PROVIDER_AUTH_MODES.map((mode) => mode.value)).toEqual(['apiKey', 'none', 'oauth']);
    expect(PROVIDER_DISCOVERY_TYPES.map((type) => type.value)).toEqual([
      'openai-models-list',
      'ollama',
      'llama.cpp',
      'lm-studio',
      'litellm',
      'proxy',
      'apple-foundation-models',
    ]);
    for (const entry of [...PROVIDER_AUTH_MODES, ...PROVIDER_DISCOVERY_TYPES]) {
      expect(entry.label, entry.value).toBeTruthy();
      expect(entry.hint, entry.value).toBeTruthy();
    }
  });
});

describe('isOmpProviderApi', () => {
  test('accepts every declared dialect and rejects near-misses', () => {
    for (const api of PROVIDER_APIS) expect(isOmpProviderApi(api), api).toBe(true);

    // Case and spelling are the contract: omp's schema is exact.
    expect(isOmpProviderApi('openai-completion')).toBe(false);
    expect(isOmpProviderApi('OpenAI-Completions')).toBe(false);
    expect(isOmpProviderApi('anthropic')).toBe(false);
    expect(isOmpProviderApi('')).toBe(false);
  });

  test('rejects non-string inputs', () => {
    for (const value of [undefined, null, 42, true, {}, ['openai-completions']]) {
      expect(isOmpProviderApi(value), String(value)).toBe(false);
    }
  });
});

describe('isProviderAuthMode', () => {
  test('accepts only the three literal modes', () => {
    expect(isProviderAuthMode('apiKey')).toBe(true);
    expect(isProviderAuthMode('none')).toBe(true);
    expect(isProviderAuthMode('oauth')).toBe(true);

    expect(isProviderAuthMode('apikey')).toBe(false);
    expect(isProviderAuthMode('APIKey')).toBe(false);
    expect(isProviderAuthMode('')).toBe(false);
    for (const value of [undefined, null, 0, {}, ['apiKey']]) {
      expect(isProviderAuthMode(value), String(value)).toBe(false);
    }
  });
});

describe('isProviderDiscoveryType', () => {
  test('accepts every declared discovery type and rejects others', () => {
    for (const entry of PROVIDER_DISCOVERY_TYPES) {
      expect(isProviderDiscoveryType(entry.value), entry.value).toBe(true);
    }
    expect(isProviderDiscoveryType('ollama-native')).toBe(false);
    expect(isProviderDiscoveryType('lmstudio')).toBe(false);
    expect(isProviderDiscoveryType('')).toBe(false);
    for (const value of [undefined, null, 7, {}, ['ollama']]) {
      expect(isProviderDiscoveryType(value), String(value)).toBe(false);
    }
  });
});

describe('isProviderThinkingEffort', () => {
  test('accepts the ladder but not off/auto or unknown labels', () => {
    for (const effort of PROVIDER_THINKING_EFFORTS) {
      expect(isProviderThinkingEffort(effort), effort).toBe(true);
    }
    expect(isProviderThinkingEffort('off')).toBe(false);
    expect(isProviderThinkingEffort('auto')).toBe(false);
    expect(isProviderThinkingEffort('none')).toBe(false);
    expect(isProviderThinkingEffort('Medium')).toBe(false);
    for (const value of [undefined, null, 1, {}, ['low']]) {
      expect(isProviderThinkingEffort(value), String(value)).toBe(false);
    }
  });
});

describe('isMaskedApiKey', () => {
  test('detects the UI placeholder shape', () => {
    // The settings UI echoes a stored key back as `sk-••••…`; persisting that
    // placeholder would make a provider look configured.
    expect(isMaskedApiKey('sk-••••…')).toBe(true);
    expect(isMaskedApiKey('•••')).toBe(true);
    expect(isMaskedApiKey('x•••y')).toBe(true);
  });

  test('rejects short bullets and non-strings', () => {
    // Fewer than three bullets is not the mask shape.
    expect(isMaskedApiKey('sk-••')).toBe(false);
    expect(isMaskedApiKey('sk-1234')).toBe(false);
    expect(isMaskedApiKey('')).toBe(false);
    for (const value of [undefined, null, 123, {}, ['•••']]) {
      expect(isMaskedApiKey(value), String(value)).toBe(false);
    }
  });
});

describe('inferProviderApi', () => {
  test('claims the unambiguous hosts', () => {
    expect(inferProviderApi('https://api.anthropic.com/v1')).toBe('anthropic-messages');
    expect(inferProviderApi('https://generativelanguage.googleapis.com/v1beta')).toBe('google-generative-ai');
    expect(inferProviderApi('https://my.openai.azure.com/openai/deployments/x')).toBe('azure-openai-responses');
  });

  test('everything else defaults to the chat-completions dialect', () => {
    expect(inferProviderApi('')).toBe('openai-completions');
    expect(inferProviderApi('http://localhost:11434/v1')).toBe('openai-completions');
    expect(inferProviderApi('https://api.openai.com/v1')).toBe('openai-completions');
    expect(inferProviderApi('https://openrouter.ai/api/v1')).toBe('openai-completions');
  });

  test('requires the literal host spellings', () => {
    // "anthropic." needs the dot: a proxy named `anthropic-proxy` or an
    // `anthropicai` host is NOT the Anthropic API and must not be guessed.
    expect(inferProviderApi('https://anthropic-proxy.internal/v1')).toBe('openai-completions');
    expect(inferProviderApi('https://anthropicai.example/v1')).toBe('openai-completions');
    expect(inferProviderApi('https://api.openai.azure-proxy.example')).toBe('openai-completions');
  });

  test('is case-insensitive', () => {
    expect(inferProviderApi('HTTPS://API.ANTHROPIC.COM/V1')).toBe('anthropic-messages');
    expect(inferProviderApi('https://OPENAI.AZURE.COM/v1')).toBe('azure-openai-responses');
  });

  test('the first matching rule wins', () => {
    // Anthropic is checked before Azure, so a URL matching both resolves to
    // anthropic-messages.
    expect(inferProviderApi('https://api.anthropic.com.openai.azure.com/x')).toBe('anthropic-messages');
  });
});

describe('providerEmptyReason', () => {
  test('discovery — declared or implied by modelSource — explains the emptiness', () => {
    const expected = 'omp discovers this provider’s models live — they appear in the chat model picker, not here.';
    expect(providerEmptyReason({ discovery: 'ollama' })).toBe(expected);
    expect(providerEmptyReason({ modelSource: 'discovery' })).toBe(expected);
    expect(providerEmptyReason({ discovery: 'lm-studio', modelSource: 'override' })).toBe(expected);
  });

  test('override names the credential only when the endpoint is keyless', () => {
    expect(providerEmptyReason({ modelSource: 'override', auth: 'none' })).toBe(
      'Endpoint override — omp keeps its own model list for this provider. Use “fetch models” to add specific ids.',
    );
    expect(providerEmptyReason({ modelSource: 'override', auth: 'apiKey' })).toBe(
      'Endpoint override — omp keeps its own model list for this provider. It still needs a credential: use “connect” to supply one, or “fetch models” to add specific ids.',
    );
    // oauth is still a credential the endpoint needs.
    expect(providerEmptyReason({ modelSource: 'override', auth: 'oauth' })).toContain('It still needs a credential');
  });

  test('a keyless non-override provider points at fetch models', () => {
    expect(providerEmptyReason({ auth: 'none' })).toBe(
      'No models registered yet. This server is keyless, so use “fetch models” to list what it serves.',
    );
    expect(providerEmptyReason({ auth: 'none', modelSource: 'fetch' })).toBe(
      'No models registered yet. This server is keyless, so use “fetch models” to list what it serves.',
    );
  });

  test('unexplained emptiness stays undefined so callers can flag it', () => {
    expect(providerEmptyReason({})).toBeUndefined();
    expect(providerEmptyReason({ auth: 'apiKey', modelSource: 'fetch' })).toBeUndefined();
    expect(providerEmptyReason({ auth: 'oauth' })).toBeUndefined();
  });
});

describe('providerFetchBlockReason', () => {
  test('a discovery provider is blocked even with an endpoint', () => {
    const expected =
      'omp lists this provider’s models itself — importing would freeze a snapshot beside that live list. Use “refresh”.';
    expect(providerFetchBlockReason({ baseUrl: 'http://localhost:11434', discovery: 'ollama' })).toBe(expected);
    expect(providerFetchBlockReason({ baseUrl: 'http://x/v1', modelSource: 'discovery' })).toBe(expected);
  });

  test('a provider without an endpoint is blocked', () => {
    const expected = 'This provider has no endpoint Kabmo can probe — omp owns its URL. Use “refresh” instead.';
    expect(providerFetchBlockReason({})).toBe(expected);
    expect(providerFetchBlockReason({ baseUrl: '' })).toBe(expected);
    expect(providerFetchBlockReason({ baseUrl: undefined, modelSource: 'fetch' })).toBe(expected);
  });

  test('a plain endpoint is fetchable, and discovery outranks the missing endpoint', () => {
    expect(providerFetchBlockReason({ baseUrl: 'https://api.openai.com/v1' })).toBeUndefined();
    expect(providerFetchBlockReason({ baseUrl: 'https://x/v1', modelSource: 'override' })).toBeUndefined();
    // Precedence: with both conditions true the discovery wording is reported.
    expect(providerFetchBlockReason({ discovery: 'proxy' })).toContain('omp lists this provider’s models itself');
  });
});
