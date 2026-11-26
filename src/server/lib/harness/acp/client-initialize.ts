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
 * **Only a VERSION refusal is retried.** The first version of this retried on
 * any `AcpRequestError`, which re-sent `initialize` to an agent that had refused
 * it for its own reasons (`Invalid params`, a broken config) and reported the
 * second failure as if the version were at fault. The retry now needs evidence
 * that v2 is the problem: the spec's version-mismatch code, a `supported` list
 * that excludes 2, or the adapter's own "unsupported version" wording.
 *
 * The result is normalized into the v1-shaped record the rest of Kabmo reads
 * (`normalizeInitializeResult`); the negotiated major is kept on it.
 */

import {
  ACP_PROTOCOL_VERSION,
  KABMO_CLIENT_CAPABILITIES,
  assertProtocolVersion,
} from '@/server/lib/harness/acp/client-capabilities';
import { AcpRequestError } from '@kabmo-labs/kabmo-acp-mapper/calls';
import { asRecord, normalizeInitializeResult } from '@kabmo-labs/kabmo-acp-protocol/v2';
import type { AcpInitializeResult } from '@kabmo-labs/kabmo-acp-protocol/protocol';

/** One request/response round trip; `AcpProcess.call` is one. */
export type AcpInitializeInvoke = <T>(method: string, params: unknown, timeoutMs: number) => Promise<T>;

const CLIENT_INFO = { name: 'kabmo', title: 'Kabmo', version: '0.1' };

/** The spec's `-32022`, answered with the majors the agent does support. */
const UNSUPPORTED_PROTOCOL_VERSION = -32022;

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

/**
 * Whether a refused `initialize` is a VERSION mismatch, which is the only
 * refusal a v1 retry can fix.
 */
export function isVersionRefusal(error: unknown): boolean {
  if (!(error instanceof AcpRequestError)) return false;
  if (error.code === UNSUPPORTED_PROTOCOL_VERSION) return true;
  const data = asRecord(error.data);
  const supported = data?.supported;
  if (Array.isArray(supported)) {
    const versions = supported.filter((value): value is number => typeof value === 'number');
    if (versions.length > 0 && !versions.includes(2)) return true;
  }
  return /unsupported\s+(protocol\s+)?version|protocol version .*not supported/i.test(error.message);
}

/**
 * The major this client ASKS for. `KABMO_ACP_PROTOCOL=1` pins every connection
 * to v1 — the kill switch for an adapter that misbehaves under the v2 dialect
 * (which upstream still ships behind an unstable feature). Unset means the
 * hybrid v2 request with a v1 retry.
 */
export function acpProtocolPreference(): 1 | 2 {
  return Bun.env.KABMO_ACP_PROTOCOL === '1' ? 1 : 2;
}

export async function initializeAcpAgent(
  request: AcpInitializeInvoke,
  capabilities: Record<string, unknown> = KABMO_CLIENT_CAPABILITIES,
  timeoutMs = 60_000,
): Promise<AcpInitializeResult> {
  const pinned = acpProtocolPreference();
  let raw: Record<string, unknown>;
  try {
    raw = asRecord(
      await request<unknown>('initialize', pinned === 1 ? v1Request(capabilities) : hybridRequest(capabilities), timeoutMs),
    ) ?? {};
    if (pinned === 1) {
      const result = normalizeInitializeResult(raw);
      assertProtocolVersion(result);
      return result;
    }
  } catch (first) {
    // A dead process or a timeout has nothing to renegotiate, and neither does
    // an agent that refused for its own reason: re-sending would hide the real
    // error behind a second attempt.
    if (!isVersionRefusal(first)) throw first;
    const firstMessage = first instanceof Error ? first.message : String(first);
    try {
      raw = asRecord(await request<unknown>('initialize', v1Request(capabilities), timeoutMs)) ?? {};
    } catch (retry) {
      const b = retry instanceof Error ? retry.message : String(retry);
      throw new Error(`initialize failed (v2 attempt: ${firstMessage}; v1 attempt: ${b})`);
    }
  }
  const result = normalizeInitializeResult(raw);
  assertProtocolVersion(result);
  return result;
}
