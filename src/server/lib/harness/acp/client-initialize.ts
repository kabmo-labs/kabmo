/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The client half of `initialize`, kept out of `client.ts` because the transport
 * file has a line ceiling and this is pure protocol.
 *
 * ## Speaking both majors
 *
 * The client sends v2 as its latest version, but the request also carries the v1
 * field names (`clientCapabilities`/`clientInfo`). Migration §Version
 * negotiation says a v1 agent reads a v2 request without those fields and loses
 * the client's file-system support; carrying both means a v1 agent answers 1 and
 * still sees the capabilities it understands, while a v2 agent ignores the v1
 * names as unknown fields.
 *
 * A strict v1 agent may reject version 2 instead of answering 1. The connection
 * is still uninitialized after a failed `initialize`, so one clean v1 retry is
 * allowed and is what keeps such an agent working.
 *
 * The result is normalized into the v1-shaped record the rest of Kabmo reads
 * (`normalizeInitializeResult`); the negotiated major is kept on it.
 */

import {
  ACP_PROTOCOL_VERSION,
  KABMO_CLIENT_CAPABILITIES,
  assertProtocolVersion,
} from '@/server/lib/harness/acp/client-capabilities';
import { AcpRequestError } from '@/server/lib/harness/acp/calls';
import { asRecord, normalizeInitializeResult } from '@/server/lib/harness/acp/v2';
import type { AcpInitializeResult } from '@/server/lib/harness/acp/protocol';

/** One request/response round trip; `AcpProcess.call` is one. */
export type AcpInitializeInvoke = <T>(method: string, params: unknown, timeoutMs: number) => Promise<T>;

const CLIENT_INFO = { name: 'kabmo', title: 'Kabmo', version: '0.1' };

/** v1 capabilities for a v1 peer; v2 removed fs/terminal and Kabmo advertises neither. */
function v1Request(capabilities: Record<string, unknown>): Record<string, unknown> {
  return {
    protocolVersion: 1,
    clientCapabilities: capabilities,
    clientInfo: CLIENT_INFO,
  };
}

/** v2 request plus the v1 field names, for a peer that selects v1 instead. */
function hybridRequest(capabilities: Record<string, unknown>): Record<string, unknown> {
  return {
    protocolVersion: ACP_PROTOCOL_VERSION,
    capabilities: {},
    info: CLIENT_INFO,
    clientCapabilities: capabilities,
    clientInfo: CLIENT_INFO,
  };
}

export async function initializeAcpAgent(
  request: AcpInitializeInvoke,
  capabilities: Record<string, unknown> = KABMO_CLIENT_CAPABILITIES,
  timeoutMs = 60_000,
): Promise<AcpInitializeResult> {
  let raw: Record<string, unknown>;
  try {
    raw = asRecord(await request<unknown>('initialize', hybridRequest(capabilities), timeoutMs)) ?? {};
  } catch (first) {
    // Only an ANSWERED initialize is retried: a dead process or a timeout has
    // nothing to renegotiate. The connection is still uninitialized after a
    // failed `initialize`, so a v1 retry is allowed by both specs.
    if (!(first instanceof AcpRequestError)) throw first;
    try {
      raw = asRecord(await request<unknown>('initialize', v1Request(capabilities), timeoutMs)) ?? {};
    } catch (retry) {
      const b = retry instanceof Error ? retry.message : String(retry);
      throw new Error(`initialize failed (v2 attempt: ${first.message}; v1 attempt: ${b})`);
    }
  }
  const result = normalizeInitializeResult(raw);
  assertProtocolVersion(result);
  return result;
}
