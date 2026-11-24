/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Ending an ACP session's life.
 *
 * Split out of `session.ts` for the file ceiling, and because one rule decides
 * every branch here: a process Kabmo is shutting down must NOT be reported as a
 * failure, while an agent that died mid-turn must say why. The exit report and
 * the child-outcome row both read that distinction, so they belong together.
 */

import type { AcpExitInfo } from '@/server/lib/harness/acp/session-exit';

/** What a teardown has to stop, clear and report. */
export interface AcpLifecycleHost {
  destroyed: boolean;
  /** True only when Kabmo itself is closing the session. */
  closing: boolean;
  readonly idle: { stop(): void };
  readonly background: { stop(): void };
  readonly permissions: { clear(): void; size(): number };
  /** Close every child card; a dead parent has no later frame to report. */
  finishSubagents(): void;
  /** `session/close`, when the agent advertises it. */
  closeAgentSession?(): Promise<void>;
  runDestroyHook(): void;
  disposeProcess(): Promise<void>;
  reportExit(info: AcpExitInfo): Promise<void>;
}

/** `session/close`, when the agent advertised `sessionCapabilities.close`.
 *  v2 frees the agent's own state and cancels its remote work; a v1 agent has
 *  no such verb and the process disposal is the whole teardown. */
export async function closeAcpSession(host: AcpCloseHost): Promise<void> {
  if (!host.sessionId || !host.capabilities.closeSession) return;
  await host.process.closeSession(host.sessionId, 5_000);
}

/** What the polite close reads; `AcpSession` satisfies it. */
export interface AcpCloseHost {
  readonly sessionId: string;
  readonly capabilities: { closeSession: boolean };
  readonly process: { closeSession(sessionId: string, timeoutMs?: number): Promise<unknown> };
}

/** The agent process is gone. A teardown Kabmo started reports nothing. */
export function acpExited(host: AcpLifecycleHost, info: AcpExitInfo): Promise<void> {
  const closing = host.closing;
  host.destroyed = true;
  host.background.stop();
  host.idle.stop();
  host.finishSubagents();
  host.runDestroyHook();
  return closing ? Promise.resolve() : host.reportExit(info);
}

/** Stop the agent and wait for it. */
export async function destroyAcp(host: AcpLifecycleHost): Promise<void> {
  if (host.destroyed) return;
  host.destroyed = true;
  host.closing = true;
  host.background.stop();
  host.idle.stop();
  host.finishSubagents();
  host.permissions.clear();
  host.runDestroyHook();
  // The polite verb first: v2 `session/close` frees the agent's own state and
  // cancels its remote work. A refusal is not a failure — the process is
  // disposed either way, which is what v1-only agents always relied on.
  await host.closeAgentSession?.().catch(() => {});
  await host.disposeProcess().catch(() => {});
}
