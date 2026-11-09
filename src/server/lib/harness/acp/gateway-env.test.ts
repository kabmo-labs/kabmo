/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The one body field that broke every Claude turn against a strict gateway.
 *
 * Measured on kenari.id: any `/v1/messages` carrying `metadata.user_id` — the
 * attribution object Claude Code adds — answered `400 the model's provider
 * rejected the request. check the model id and request fields`, while the same
 * body without it, or with `metadata: {}`, completed. `CLAUDE_CODE_EXTRA_BODY`
 * is the documented top-level merge, so it is the one place that can empty the
 * field without touching thinking, context management or tools.
 */

import { describe, expect, test } from 'bun:test';
import { withGatewayCompatibility } from '@/server/lib/harness/acp/gateway-env';

describe('withGatewayCompatibility', () => {
  test('a custom Claude base URL gets an empty metadata object', () => {
    const env = withGatewayCompatibility('claude', {
      ANTHROPIC_BASE_URL: 'https://kenari.id',
      ANTHROPIC_AUTH_TOKEN: 'kn',
    });
    expect(JSON.parse(env?.CLAUDE_CODE_EXTRA_BODY ?? '{}')).toEqual({ metadata: {} });
    expect(env?.ANTHROPIC_BASE_URL).toBe('https://kenari.id');
  });

  test('a direct Anthropic connection keeps its attribution', () => {
    const env = { ANTHROPIC_BASE_URL: 'https://api.anthropic.com' };
    expect(withGatewayCompatibility('claude', env)).toBe(env);
  });

  test('another harness is untouched', () => {
    const env = { ANTHROPIC_BASE_URL: 'https://kenari.id' };
    expect(withGatewayCompatibility('omp-acp', env)).toBe(env);
    expect(withGatewayCompatibility('claude', undefined)).toBeUndefined();
  });

  test('an existing extra body is preserved, and its own metadata wins', () => {
    const kept = withGatewayCompatibility('claude', {
      ANTHROPIC_BASE_URL: 'https://gw',
      CLAUDE_CODE_EXTRA_BODY: JSON.stringify({ temperature: 0.2 }),
    });
    expect(JSON.parse(kept?.CLAUDE_CODE_EXTRA_BODY ?? '{}')).toEqual({ temperature: 0.2, metadata: {} });

    const own = withGatewayCompatibility('claude', {
      ANTHROPIC_BASE_URL: 'https://gw',
      CLAUDE_CODE_EXTRA_BODY: JSON.stringify({ metadata: { user_id: 'tenant' } }),
    });
    expect(JSON.parse(own?.CLAUDE_CODE_EXTRA_BODY ?? '{}')).toEqual({ metadata: { user_id: 'tenant' } });
  });

  test('a malformed extra body is left for the user to fix', () => {
    const env = { ANTHROPIC_BASE_URL: 'https://gw', CLAUDE_CODE_EXTRA_BODY: '{oops' };
    expect(withGatewayCompatibility('claude', env)).toBe(env);
  });

  test('a malformed base URL is not guessed at', () => {
    const env = { ANTHROPIC_BASE_URL: 'not a url' };
    expect(withGatewayCompatibility('claude', env)).toBe(env);
  });
});
