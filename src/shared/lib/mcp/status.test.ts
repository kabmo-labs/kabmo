/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The MCP status rule: a probe result, never a guess from `enabled`.
 *
 * The bug this pins: omp publishes no MCP state over RPC, so a status derived
 * from the checkbox would paint a green dot over a server that never answered.
 */

import { describe, expect, test } from 'bun:test';
import { mcpServerStatus } from '@/shared/lib/mcp/status';

describe('mcpServerStatus', () => {
  test('a disabled server is disabled regardless of the probe', () => {
    expect(mcpServerStatus({ enabled: false, checking: false, probe: { ok: true } })).toBe('disabled');
  });

  test('an in-flight probe is checking', () => {
    expect(mcpServerStatus({ enabled: true, checking: true, probe: null })).toBe('checking');
  });

  test('a successful handshake is active', () => {
    expect(mcpServerStatus({ enabled: true, checking: false, probe: { ok: true } })).toBe('active');
  });

  test('a failed handshake is an error', () => {
    expect(mcpServerStatus({ enabled: true, checking: false, probe: { ok: false } })).toBe('error');
  });

  test('a server never probed is unknown, not active', () => {
    expect(mcpServerStatus({ enabled: true, checking: false, probe: null })).toBe('unknown');
  });
});
