/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Version negotiation at `initialize`.
 *
 * The client sends v2 as its latest version and carries the v1 field names in
 * the same request, so a v1 peer answers 1 without losing the client's
 * capabilities. A strict v1 peer that REJECTS version 2 gets one clean v1
 * retry; a dead process or timeout is not retried.
 */

import { describe, expect, test } from 'bun:test';
import { initializeAcpAgent, type AcpInitializeInvoke } from '@/server/lib/harness/acp/client-initialize';
import { AcpRequestError } from '@/server/lib/harness/acp/calls';

/**
 * A one-method invoke. The cast is the seam's own shape: `AcpInitializeInvoke`
 * is generic over the caller's requested result, and these doubles answer the
 * only method under test.
 */
function invokeAnswering(answer: (params: Record<string, unknown>) => Promise<unknown>): AcpInitializeInvoke {
  return ((_method: string, params: unknown) => answer(params as Record<string, unknown>)) as AcpInitializeInvoke;
}

describe('initializeAcpAgent', () => {
  test('sends v2 plus the v1 field names and normalizes a v2 answer', async () => {
    const sent: Record<string, unknown>[] = [];
    const result = await initializeAcpAgent(invokeAnswering(async (params) => {
      sent.push(params);
      return {
        protocolVersion: 2,
        info: { name: 'agent', version: '2.0' },
        capabilities: { session: { prompt: { image: {} } } },
      };
    }));
    expect(sent[0]).toMatchObject({
      protocolVersion: 2,
      capabilities: {},
      info: { name: 'kabmo', version: '0.1' },
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
    });
    expect(result.protocolVersion).toBe(2);
    expect(result.agentCapabilities?.promptCapabilities?.image).toBe(true);
  });

  test('retries a rejected v2 initialize as a clean v1 request', async () => {
    const versions: unknown[] = [];
    const result = await initializeAcpAgent(invokeAnswering(async (params) => {
      const version = params.protocolVersion;
      versions.push(version);
      if (version === 2) throw new AcpRequestError('Unsupported protocol version', -32022);
      return { protocolVersion: 1, agentCapabilities: { loadSession: true } };
    }));
    expect(versions).toEqual([2, 1]);
    expect(result.protocolVersion).toBe(1);
    expect(result.agentCapabilities?.loadSession).toBe(true);
  });

  test('does not retry a transport failure', async () => {
    let calls = 0;
    await expect(initializeAcpAgent(invokeAnswering(async () => {
      calls += 1;
      throw new Error('ACP agent exited');
    }))).rejects.toThrow('ACP agent exited');
    expect(calls).toBe(1);
  });
});
