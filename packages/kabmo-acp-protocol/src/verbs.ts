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

import type { AcpMcpServerWire, AcpSessionInfo, AcpSessionNewResult } from './protocol';
import { normalizeConfigOptions, normalizeSessionResult } from './v2';

/** One request/response round trip against an ACP agent. Implemented by
 *  `AcpProcess.call`; a test supplies its own. */
export type AcpInvoke = <T>(method: string, params: unknown, timeoutMs: number) => Promise<T>;
/** Fire-and-forget frame (notifications only). */
export type AcpNotify = (method: string, params: unknown) => void;

/** The negotiated major, so a verb can shape its params and normalize its answer. */
export type AcpDialect = 1 | 2;

/** The extra roots one setup request carries, when the agent advertised them. */
export interface SessionDirs {
  additionalDirectories?: string[];
}

export async function newSession(
  invoke: AcpInvoke,
  cwd: string,
  timeoutMs = 120_000,
  dialect: AcpDialect = 1,
  mcpServers: AcpMcpServerWire[] = [],
  dirs: SessionDirs = {},
): Promise<AcpSessionNewResult> {
  const result = await invoke<Record<string, unknown>>('session/new', { cwd, mcpServers, ...dirs }, timeoutMs);
  return dialect === 2 ? normalizeSessionResult(result) : (result as unknown as AcpSessionNewResult);
}

export async function loadSession(
  invoke: AcpInvoke,
  sessionId: string,
  cwd: string,
  timeoutMs = 120_000,
  mcpServers: AcpMcpServerWire[] = [],
  dirs: SessionDirs = {},
): Promise<unknown> {
  return invoke('session/load', { sessionId, cwd, mcpServers, ...dirs }, timeoutMs);
}

export async function resumeSession(
  invoke: AcpInvoke,
  sessionId: string,
  cwd: string,
  timeoutMs = 120_000,
  dialect: AcpDialect = 1,
  mcpServers: AcpMcpServerWire[] = [],
  /** v2 only: `{ type: 'start' }` replays the retained history as ordinary
   *  `session/update` frames before the reply. v1 peers replay through
   *  `session/load` instead. */
  replayFrom?: { type: 'start' },
  dirs: SessionDirs = {},
): Promise<unknown> {
  const result = await invoke<Record<string, unknown>>(
    'session/resume',
    { sessionId, cwd, mcpServers, ...(dialect === 2 && replayFrom ? { replayFrom } : {}), ...dirs },
    timeoutMs,
  );
  return dialect === 2 ? normalizeSessionResult(result) : result;
}

export async function forkSession(
  invoke: AcpInvoke,
  sessionId: string,
  cwd: string,
  timeoutMs = 120_000,
  target?: Record<string, unknown>,
  meta?: Record<string, unknown>,
  mcpServers: AcpMcpServerWire[] = [],
  dirs: SessionDirs = {},
): Promise<AcpSessionNewResult> {
  return invoke<AcpSessionNewResult>(
    'session/fork',
    { sessionId, cwd, mcpServers, ...dirs, ...(target ? { target } : {}), ...(meta ? { _meta: meta } : {}) },
    timeoutMs,
  );
}

export async function listSessions(invoke: AcpInvoke, cwd?: string, timeoutMs = 60_000): Promise<AcpSessionInfo[]> {
  const result = await invoke<{ sessions?: AcpSessionInfo[] }>('session/list', cwd ? { cwd } : {}, timeoutMs);
  return Array.isArray(result?.sessions) ? result.sessions : [];
}

/**
 * Every session an agent reports, following `nextCursor`.
 *
 * `listSessions` drops the cursor, so an agent with more than one page answered
 * a truncated list. That is not an acceptable import: a chat the user ran in a
 * terminal would simply be missing. `maxPages` bounds a broken agent that keeps
 * repeating the same cursor, and a repeated cursor ends the walk rather than
 * looping forever.
 *
 * The caller passes NO `cwd`: codex's cwd-filtered list tears its app-server
 * down before answering (measured, 2.5.0 and 2.7.0), and the import files each
 * row by its own cwd anyway.
 */
export async function listAllSessions(
  invoke: AcpInvoke,
  timeoutMs = 60_000,
  maxPages = 20,
): Promise<AcpSessionInfo[]> {
  const out: AcpSessionInfo[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page += 1) {
    const result: { sessions?: AcpSessionInfo[]; nextCursor?: string | null } = await invoke(
      'session/list',
      cursor ? { cursor } : {},
      timeoutMs,
    );
    if (Array.isArray(result?.sessions)) out.push(...result.sessions);
    const next: string | null = typeof result?.nextCursor === 'string' && result.nextCursor
      ? result.nextCursor
      : null;
    if (!next || seen.has(next)) break;
    seen.add(next);
    cursor = next;
  }
  return out;
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

/** Sign this client in with one of the agent's advertised `authMethods`.
 *  `_meta.headless` tells the agent no interactive terminal is attached, so a
 *  method that needs one refuses instead of parking the spawn. */
export async function authenticate(
  invoke: AcpInvoke,
  methodId: string,
  timeoutMs = 120_000,
): Promise<unknown> {
  return invoke('authenticate', { methodId, _meta: { headless: true } }, timeoutMs);
}

/** `session/set_model`: select a model on an agent that publishes a `models`
 *  block instead of a `model` config option (measured on grok). */
export async function setModel(
  invoke: AcpInvoke,
  sessionId: string,
  modelId: string,
  timeoutMs = 30_000,
): Promise<unknown> {
  return invoke('session/set_model', { sessionId, modelId }, timeoutMs);
}

/** Remove one session from the agent's own history (`sessionCapabilities.delete`). */
export async function deleteSession(invoke: AcpInvoke, sessionId: string, timeoutMs = 30_000): Promise<unknown> {
  return invoke('session/delete', { sessionId }, timeoutMs);
}
