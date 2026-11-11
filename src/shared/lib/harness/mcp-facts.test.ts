/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * MCP delivery per harness.
 *
 * The table is exhaustive over the BUILT-INS; a user-added harness has no row,
 * and the spawn path must still deliver its servers. The fallback is ACP because
 * that is the only transport the add form offers.
 */

import { describe, expect, test } from 'bun:test';
import { mcpDelivery } from '@/shared/lib/harness/mcp-facts';

describe('mcpDelivery', () => {
  test('omp over RPC reads its own file', () => {
    expect(mcpDelivery('omp-rpc')).toBe('omp-config');
  });

  test('every ACP harness is injected on session/new', () => {
    expect(mcpDelivery('claude')).toBe('acp');
    expect(mcpDelivery('omp-acp')).toBe('acp');
  });

  test('a user-added harness falls back to ACP', () => {
    expect(mcpDelivery('my-agent')).toBe('acp');
  });
});
