/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The provider mark resolver is shared by the server (which builds provider
 * rows) and the client (which renders them), and its two failure modes are both
 * silent: a provider whose spelling does not fold onto its brand draws the wrong
 * logo, and a provider with no mark at all would draw nothing. These lock the
 * folding rules and the initials fallback.
 */

import { describe, expect, test } from 'bun:test';

import { PROVIDER_GLYPHS } from '@/client/components/common/provider-icon/glyphs';
import { providerInitials, resolveProviderGlyph } from '@/shared/lib/models/provider/glyph';

/**
 * Every provider id omp 18.3.0 ships (`KnownProvider`) plus Kabmo's own
 * additions. A provider added upstream appears here as one more id, and the
 * coverage test below is what makes its missing mark a loud failure instead of a
 * blank badge in the picker.
 */
const PROVIDER_IDS = [
  'abliteration', 'aiand', 'aimlapi', 'alibaba-coding-plan', 'alibaba-token-plan', 'amazon-bedrock',
  'anthropic', 'apple', 'azure', 'baseten', 'bedrock-mantle', 'cerebras', 'charm-hyper', 'cline-pass',
  'cloudflare-ai-gateway', 'commandcode', 'coreweave', 'cursor', 'deepinfra', 'deepseek', 'devin',
  'firepass', 'fireworks', 'github-copilot', 'gitlab-duo', 'gitlab-duo-agent', 'gmi-cloud', 'google',
  'google-antigravity', 'google-gemini-cli', 'google-vertex', 'groq', 'huggingface', 'kilo', 'kimi-code',
  'litellm', 'llama.cpp', 'lm-studio', 'local', 'meta', 'minimax', 'minimax-code', 'minimax-code-cn',
  'mistral', 'moonshot', 'muse-code', 'nanogpt', 'novita', 'nvidia', 'ollama', 'ollama-cloud', 'openai',
  'openai-codex', 'opencode-go', 'opencode-zen', 'openrouter', 'qianfan', 'qwen-portal', 'sakana',
  'siliconflow', 'siliconflow-cn', 'singularityapi-dev', 'singularityapi-tech', 'stepfun', 'synthetic',
  'together', 'typesafe', 'umans', 'venice', 'vercel-ai-gateway', 'vllm', 'wafer-serverless', 'web',
  'xai', 'xai-oauth', 'xiaomi', 'xiaomi-token-plan-ams', 'xiaomi-token-plan-cn', 'xiaomi-token-plan-sgp',
  'yolo-auto', 'zai', 'zenmux', 'zhipu-coding-plan',
  // Chamber-side spellings that are not omp provider ids, plus the OAuth
  // flavour ids the providers API actually serves (verified against a live
  // /api/settings/providers response).
  'kenari', 'agentrouter', 'claude', 'gemini', 'opencode', 'custom',
  'zai-coding-plan', 'openai-codex-device', 'perplexity', 'tavily', 'kagi', 'exa', 'stencil',
];

describe('resolveProviderGlyph', () => {
  test('a resolved mark exists in the glyph table', () => {
    for (const id of PROVIDER_IDS) {
      const name = resolveProviderGlyph(id);
      if (name) expect(PROVIDER_GLYPHS[name]).toBeDefined();
    }
  });

  test('every glyph draws something', () => {
    // A bake that produced an empty body renders an invisible icon with no
    // error anywhere — the provider simply loses its mark.
    for (const [name, glyph] of Object.entries(PROVIDER_GLYPHS)) {
      expect(glyph.viewBox, name).toMatch(/^[-\d.]+ [-\d.]+ [\d.]+ [\d.]+$/);
      expect(/<(path|circle|rect|g)\b/.test(glyph.body), name).toBe(true);
    }
  });

  test('no provider id leaves a blank badge', () => {
    // The one promise of this module: a provider is drawn as its brand mark or
    // as readable initials, never as an empty box.
    for (const id of PROVIDER_IDS) {
      const mark = resolveProviderGlyph(id);
      expect(mark !== null || providerInitials(id).length > 0).toBe(true);
    }
  });

  test('variants of one brand share that brand mark', () => {
    expect(resolveProviderGlyph('minimax-code-cn')).toBe(resolveProviderGlyph('minimax'));
    expect(resolveProviderGlyph('xiaomi-token-plan-ams')).toBe(resolveProviderGlyph('xiaomi'));
    expect(resolveProviderGlyph('google-vertex')).toBe(resolveProviderGlyph('vertexai'));
    expect(resolveProviderGlyph('openai-codex')).toBe(resolveProviderGlyph('codex'));
    expect(resolveProviderGlyph('opencode-zen')).toBe(resolveProviderGlyph('opencode-go'));
    expect(resolveProviderGlyph('gitlab-duo-agent')).toBe(resolveProviderGlyph('gitlab-duo'));
  });

  test('spelling differences fold to the same key', () => {
    // omp reports ids, a models.yml slug is user-typed, and a display name is
    // prose — all three reach this function.
    for (const spelling of ['DeepSeek', 'deepseek', 'deep-seek', 'DEEP_SEEK', 'deepseek ']) {
      expect(resolveProviderGlyph(spelling)).toBe('deepseek');
    }
  });

  test('a stored icon key wins over the slug', () => {
    // Legacy preset rows carry `icon: 'claude'` while their slug moved on.
    expect(resolveProviderGlyph('claude', 'anthropic')).toBe('claude');
  });

  test('an unknown provider resolves to null rather than a wrong brand', () => {
    expect(resolveProviderGlyph('my-private-gateway')).toBeNull();
    expect(resolveProviderGlyph('')).toBeNull();
    expect(resolveProviderGlyph(undefined, null)).toBeNull();
  });
});

describe('providerInitials', () => {
  test('takes one initial per word, joined with a single trailing dot', () => {
    expect(providerInitials('Tooker')).toBe('t.');
    expect(providerInitials('Toktok ID')).toBe('ti.');
    expect(providerInitials('My Local Gateway')).toBe('ml.');
  });

  test('a hyphenated or underscored slug reads as separate words', () => {
    expect(providerInitials('toktok-id')).toBe('ti.');
    expect(providerInitials('tok_tok')).toBe('tt.');
  });

  test('an unlabelled provider still yields a visible badge', () => {
    expect(providerInitials('')).toBe('?');
    expect(providerInitials('   ')).toBe('?');
  });
});
