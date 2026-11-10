/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The client's `initialize` advertisement and version negotiation.
 *
 * Both are promises made to the agent: the capability object says which
 * agent→client calls this client will answer, and the answer to an unsupported
 * protocol major has to be a refusal rather than a v2 frame parsed as v1.
 */

import { describe, expect, test } from 'bun:test';
import {
  ACP_PROTOCOL_VERSION,
  KABMO_CLIENT_CAPABILITIES,
  assertProtocolVersion,
} from '@/server/lib/harness/acp/client-capabilities';

describe('client capabilities', () => {
  test('advertises the fs methods the client actually implements', () => {
    expect(KABMO_CLIENT_CAPABILITIES.fs).toEqual({ readTextFile: true, writeTextFile: true });
  });

  test('advertises notices, which the frame mapper already renders', () => {
    expect(KABMO_CLIENT_CAPABILITIES.session.notices).toEqual({});
  });

  test('does not advertise surfaces with no bridge', () => {
    const advertised = KABMO_CLIENT_CAPABILITIES as Record<string, unknown>;
    expect(advertised.terminal).toBeUndefined();
    expect(advertised.elicitation).toBeUndefined();
  });
});

describe('protocol version negotiation', () => {
  test('sends v2 as its latest version', () => {
    expect(ACP_PROTOCOL_VERSION).toBe(2);
  });

  test('accepts both majors it implements', () => {
    expect(() => assertProtocolVersion({ protocolVersion: 1 })).not.toThrow();
    expect(() => assertProtocolVersion({ protocolVersion: 2 })).not.toThrow();
  });

  test('refuses a major it cannot speak, naming the agent and both versions', () => {
    expect(() => assertProtocolVersion({ protocolVersion: 3, agentInfo: { title: 'Acme' } }))
      .toThrow('Acme speaks ACP v3; Kabmo supports v1 and v2');
  });

  test('refuses an answer that reports no version at all', () => {
    expect(() => assertProtocolVersion({})).toThrow('speaks ACP vundefined');
  });
});
