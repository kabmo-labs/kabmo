/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The ACP session verbs, as free functions over an `invoke` seam.
 *
 * They live outside `client.ts` because that file owns the TRANSPORT (spawn,
 * framing, pending replies, agent->client requests) and this one owns the
 * PROTOCOL above it. Keeping them apart is what lets the transport be tested
 * with a fake invoke, and what keeps both files under the repo's line ceiling.
 *
 * `cancel` is the odd one: ACP defines `session/cancel` as a NOTIFICATION, so
 * there is no reply to await and the turn ends through the in-flight
 * `session/prompt` answer (`stopReason: "cancelled"`).
 */

import type { AcpSessionInfo, AcpSessionNewResult } from '@/server/lib/harness/acp/protocol';
import { normalizeConfigOptions, normalizeSessionResult } from '@/server/lib/harness/acp/v2';

/** One request/response round trip against an ACP agent. Implemented by
 *  `AcpProcess.call`; a test supplies its own. */
export type AcpInvoke = <T>(method: string, params: unknown, timeoutMs: number) => Promise<T>;
/** Fire-and-forget frame (notifications only). */
export type AcpNotify = (method: string, params: unknown) => void;

/** The negotiated major, so a verb can shape its params and normalize its answer. */
export type AcpDialect = 1 | 2;

export async function newSession(
  invoke: AcpInvoke,
  cwd: string,
  timeoutMs = 120_000,
  dialect: AcpDialect = 1,
): Promise<AcpSessionNewResult> {
  const result = await invoke<Record<string, unknown>>('session/new', { cwd, mcpServers: [] }, timeoutMs);
  return dialect === 2 ? normalizeSessionResult(result) : (result as unknown as AcpSessionNewResult);
}

export async function loadSession(invoke: AcpInvoke, sessionId: string, cwd: string, timeoutMs = 120_000): Promise<unknown> {
  return invoke('session/load', { sessionId, cwd, mcpServers: [] }, timeoutMs);
}

export async function resumeSession(
  invoke: AcpInvoke,
  sessionId: string,
  cwd: string,
  timeoutMs = 120_000,
  dialect: AcpDialect = 1,
): Promise<unknown> {
  const result = await invoke<Record<string, unknown>>('session/resume', { sessionId, cwd, mcpServers: [] }, timeoutMs);
  return dialect === 2 ? normalizeSessionResult(result) : result;
}

export async function forkSession(
  invoke: AcpInvoke,
  sessionId: string,
  cwd: string,
  timeoutMs = 120_000,
  target?: Record<string, unknown>,
): Promise<AcpSessionNewResult> {
  return invoke<AcpSessionNewResult>(
    'session/fork',
    { sessionId, cwd, mcpServers: [], ...(target ? { target } : {}) },
    timeoutMs,
  );
}

export async function listSessions(invoke: AcpInvoke, cwd?: string, timeoutMs = 60_000): Promise<AcpSessionInfo[]> {
  const result = await invoke<{ sessions?: AcpSessionInfo[] }>('session/list', cwd ? { cwd } : {}, timeoutMs);
  return Array.isArray(result?.sessions) ? result.sessions : [];
}

/** One prompt turn. Resolves when the agent answers `session/prompt`, which is
 *  the END of the turn in ACP (the agent streams via notifications meanwhile),
 *  so the cap is the caller's: a long coding turn legitimately takes minutes. */
export async function prompt(
  invoke: AcpInvoke,
  sessionId: string,
  blocks: unknown[],
  timeoutMs = 0,
): Promise<{ stopReason?: string; messageId?: string; usage?: unknown }> {
  return invoke('session/prompt', { sessionId, prompt: blocks }, timeoutMs);
}

export function cancel(notify: AcpNotify, sessionId: string): void {
  notify('session/cancel', { sessionId });
}

export async function setConfigOption(
  invoke: AcpInvoke,
  sessionId: string,
  configId: string,
  value: string | boolean,
  timeoutMs = 30_000,
  dialect: AcpDialect = 1,
): Promise<unknown> {
  // v2 requires the value's shape: `id` for select options, `boolean` otherwise.
  const params = dialect === 2
    ? { sessionId, configId, type: typeof value === 'boolean' ? 'boolean' : 'id', value }
    : { sessionId, configId, value };
  const result = await invoke<Record<string, unknown>>('session/set_config_option', params, timeoutMs);
  if (dialect !== 2) return result;
  return { ...result, ...(Array.isArray(result.configOptions) ? { configOptions: normalizeConfigOptions(result.configOptions) } : {}) };
}

/** omp's steering extension (advertised as `_meta.steering.supported`). */
export async function steer(
  invoke: AcpInvoke,
  sessionId: string,
  blocks: unknown[],
  queue: 'steering' | 'followUp' = 'steering',
  timeoutMs = 30_000,
): Promise<{ outcome?: string; queue?: string }> {
  return invoke('_session/steering', { sessionId, prompt: blocks, _meta: { steering: { queue } } }, timeoutMs);
}

export async function closeSession(invoke: AcpInvoke, sessionId: string, timeoutMs = 30_000): Promise<unknown> {
  return invoke('session/close', { sessionId }, timeoutMs);
}

/** The older Session Modes API; `configOptions` supersedes it but agents still
 *  publish one or the other. */
export async function setMode(
  invoke: AcpInvoke,
  sessionId: string,
  modeId: string,
  timeoutMs = 30_000,
): Promise<unknown> {
  return invoke('session/set_mode', { sessionId, modeId }, timeoutMs);
}

/** Remove one session from the agent's own history (`sessionCapabilities.delete`). */
export async function deleteSession(invoke: AcpInvoke, sessionId: string, timeoutMs = 30_000): Promise<unknown> {
  return invoke('session/delete', { sessionId }, timeoutMs);
}
