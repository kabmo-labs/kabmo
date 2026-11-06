/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One protocol vocabulary, six spellings — and the measured traps each row
 * prevents.
 *
 * The failure this pins is silent in every direction: a dialect passed through
 * from one registry to another is a value the target rejects, and codex now
 * REJECTS `wire_api = "chat"` by failing to load its whole config. The base-URL
 * rule is the other measured trap: Claude Code appends `/v1/messages` itself, so
 * a base URL that still carries `/v1` requested `/v1/v1/messages` and answered
 * an empty turn.
 */

import { describe, expect, test } from 'bun:test';

import {
  adaptBaseUrl,
  dialectFor,
  planProtocol,
  protocolOfSourceDialect,
  protocolsFor,
  supportedProtocols,
  wireApiFor,
} from '@/shared/lib/harness/dialects';

describe('protocolOfSourceDialect', () => {
  test('every registry vocabulary folds onto the same five protocols', () => {
    // omp models.yml
    expect(protocolOfSourceDialect('openai-completions')).toBe('openai-chat');
    expect(protocolOfSourceDialect('openai-responses')).toBe('openai-responses');
    expect(protocolOfSourceDialect('anthropic-messages')).toBe('anthropic-messages');
    expect(protocolOfSourceDialect('google-generative-ai')).toBe('google-genai');
    // opencode's npm package names
    expect(protocolOfSourceDialect('@ai-sdk/openai-compatible')).toBe('openai-chat');
    expect(protocolOfSourceDialect('@ai-sdk/anthropic')).toBe('anthropic-messages');
    // kimi-code types
    expect(protocolOfSourceDialect('openai_responses')).toBe('openai-responses');
    expect(protocolOfSourceDialect('vertexai')).toBe('vertex-ai');
    // codex wire_api, qwen bucket, pi api
    expect(protocolOfSourceDialect('chat')).toBe('openai-chat');
    expect(protocolOfSourceDialect('responses')).toBe('openai-responses');
    expect(protocolOfSourceDialect('openai')).toBe('openai-chat');
  });

  test('a dialect with no portable route is UNKNOWN rather than guessed', () => {
    // Bedrock signs with SigV4, Gemini CLI and the judge APIs have no `/models`;
    // mapping any of them to a chat protocol would write a provider that 401s.
    expect(protocolOfSourceDialect('bedrock-converse-stream')).toBeNull();
    expect(protocolOfSourceDialect('google-gemini-cli')).toBeNull();
    expect(protocolOfSourceDialect('openrouter-decisions')).toBeNull();
    expect(protocolOfSourceDialect(undefined)).toBeNull();
  });
});

describe('dialectFor', () => {
  test('codex is Responses-only, so a Chat source has NO spelling there', () => {
    // Measured: `wire_api = "chat"` makes codex refuse to load config at all.
    expect(dialectFor('toml-model-providers', 'openai-responses')).toBe('responses');
    expect(dialectFor('toml-model-providers', 'openai-chat')).toBeNull();
    expect(dialectFor('toml-model-providers', 'anthropic-messages')).toBeNull();
  });

  test('kimi writes the types the CURRENT CLI documents', () => {
    expect(dialectFor('toml-providers', 'openai-chat')).toBe('openai');
    expect(dialectFor('toml-providers', 'google-genai')).toBe('google-genai');
    // The retired CLI's spellings are gone rather than kept as aliases.
    expect(dialectFor('toml-providers', 'openai-chat')).not.toBe('openai_legacy');
  });

  test('qwen names its BUCKET, and its OpenAI bucket also carries the wire choice', () => {
    expect(dialectFor('json-model-providers', 'openai-chat')).toBe('openai');
    expect(dialectFor('json-model-providers', 'anthropic-messages')).toBe('anthropic');
    expect(wireApiFor('openai-responses')).toBe('responses');
    expect(wireApiFor('openai-chat')).toBe('chat-completions');
    expect(wireApiFor('anthropic-messages')).toBeNull();
  });

  test('omp and pi share one vocabulary because both are the vendor’s own names', () => {
    for (const protocol of protocolsFor('yaml-providers')) {
      expect(dialectFor('json-providers', protocol)).toBe(dialectFor('yaml-providers', protocol));
    }
  });
});

describe('planProtocol', () => {
  test('the source protocol wins when the target speaks it', () => {
    expect(planProtocol('anthropic-messages', ['anthropic-messages', 'openai-chat'])).toBe('anthropic-messages');
  });

  test('an unknown source still lands when the target has only one protocol', () => {
    expect(planProtocol(null, ['anthropic-messages'])).toBe('anthropic-messages');
    // With a real choice, "unknown" must not become a guess.
    expect(planProtocol(null, ['anthropic-messages', 'openai-chat'])).toBeNull();
  });

  test('no shared protocol means a refusal, not a substitution', () => {
    expect(planProtocol('google-genai', ['anthropic-messages'])).toBeNull();
  });
});

describe('adaptBaseUrl', () => {
  test('a vendor SDK that appends /v1 gets the HOST ROOT', () => {
    // Measured: `https://kenari.id/v1` in ANTHROPIC_BASE_URL made Claude Code
    // request `/v1/v1/messages` and answer an empty turn; the root worked.
    expect(adaptBaseUrl('https://kenari.id/v1', 'root')).toBe('https://kenari.id');
    expect(adaptBaseUrl('https://kenari.id/v1/', 'root')).toBe('https://kenari.id');
    expect(adaptBaseUrl('https://gw.example/v1beta', 'root')).toBe('https://gw.example');
  });

  test('a registry client that appends only the route keeps its /v1', () => {
    expect(adaptBaseUrl('https://kenari.id/v1', 'api-base')).toBe('https://kenari.id/v1');
    expect(adaptBaseUrl('https://kenari.id/v1/', 'api-base')).toBe('https://kenari.id/v1');
    // A base without a version segment is untouched either way.
    expect(adaptBaseUrl('https://gw.example', 'api-base')).toBe('https://gw.example');
  });
});

describe('supportedProtocols', () => {
  test('an environment harness carries exactly one protocol', () => {
    expect(supportedProtocols('env', 'anthropic-messages')).toEqual(['anthropic-messages']);
    expect(supportedProtocols('env')).toEqual([]);
  });

  test('a harness with no registry carries nothing', () => {
    expect(supportedProtocols('none')).toEqual([]);
    expect(supportedProtocols('agent-managed')).toEqual([]);
  });
});
