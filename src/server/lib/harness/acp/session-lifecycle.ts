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
  runDestroyHook(): void;
  disposeProcess(): Promise<void>;
  reportExit(info: AcpExitInfo): Promise<void>;
}

/** The agent process is gone. A teardown Kabmo started reports nothing. */
export function acpExited(host: AcpLifecycleHost, info: AcpExitInfo): Promise<void> {
  const closing = host.closing;
  host.destroyed = true;
  host.background.stop();
  host.idle.stop();
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
  host.permissions.clear();
  host.runDestroyHook();
  await host.disposeProcess().catch(() => {});
}
