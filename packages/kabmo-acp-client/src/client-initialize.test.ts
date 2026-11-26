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
import { initializeAcpAgent, type AcpInitializeInvoke } from './client-initialize';
import { AcpRequestError } from '@kabmo-labs/kabmo-acp-mapper/calls';

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
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        // Advertised because both have a consumer now: `plan` feeds the Todos
        // panel, `subagents` is what lets a v1 agent announce a child at all.
        session: { notices: {}, compaction: {}, plan: {} },
        subagents: {},
      },
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

  test('does not retry a refusal that is not about the version', async () => {
    // Re-sending `initialize` to an agent that refused for its own reason hid
    // the real error behind a second attempt, and reported the pair as a
    // version problem it was not.
    let calls = 0;
    await expect(initializeAcpAgent(invokeAnswering(async () => {
      calls += 1;
      throw new AcpRequestError('Invalid params: unknown field "capabilities"', -32602);
    }))).rejects.toThrow('Invalid params');
    expect(calls).toBe(1);
  });

  test('retries when the refusal lists only v1 as supported', async () => {
    const versions: unknown[] = [];
    const result = await initializeAcpAgent(invokeAnswering(async (params) => {
      versions.push(params.protocolVersion);
      if (params.protocolVersion === 2) {
        throw new AcpRequestError('Protocol version not supported', -32602, { requested: 2, supported: [1] });
      }
      return { protocolVersion: 1 };
    }));
    expect(versions).toEqual([2, 1]);
    expect(result.protocolVersion).toBe(1);
  });
});
