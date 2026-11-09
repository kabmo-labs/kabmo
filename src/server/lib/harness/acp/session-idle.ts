/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The idle reclaim for one ACP child.
 *
 * The omp wrapper has always reclaimed an idle `omp --mode rpc-ui` child; this
 * transport had no clock at all, so an `omp acp` (or any ACP adapter) outlived
 * the tab that spawned it by hours — measured: a live `omp acp` from a chat the
 * user had not touched since the morning. The clock itself is `IdleReaper`,
 * shared so both transports release an idle agent after the same window, and
 * the decision is here because only the session can answer "is this still
 * wanted?".
 */

import { IdleReaper } from '@/server/lib/omp/rpc/idle-reaper';
import { IDLE_REAP_MS } from '@/server/lib/omp/rpc/constants';
import type { HarnessCapabilities } from '@/server/lib/harness/capabilities';
import type { HarnessId } from '@/shared/lib/harness/catalog';

/** What the reclaim decision reads; `AcpSession` satisfies it as-is. */
export interface AcpIdleHost {
  readonly harness: HarnessId;
  readonly capabilities: HarnessCapabilities;
  isBusy(): boolean;
  destroy(): void;
}

/**
 * A working or dialog-blocked session is never reclaimed (the child would take
 * the user's question with it), and the answer is `false` so `IdleReaper`
 * re-arms instead of waiting for a frame that a parked dialog will not send.
 *
 * A child that cannot be restored is also left alone: a non-`session/load`
 * agent has no way back, and `resumeRecordedHarnessSession` refuses to spawn a
 * fresh agent under a chat's id, so reclaiming one would leave a chat that can
 * never take another prompt. `omp-acp` is the exception — it writes a session
 * file, so the chat is restored over RPC.
 */
export function reclaimIdleAcpSession(host: AcpIdleHost): boolean {
  if (host.isBusy()) return false;
  if (!host.capabilities.loadSession && host.harness !== 'omp-acp') return true;
  host.destroy();
  return true;
}

export function acpIdleReaper(host: AcpIdleHost, timeoutMs?: number): IdleReaper {
  return new IdleReaper(timeoutMs ?? IDLE_REAP_MS, () => reclaimIdleAcpSession(host));
}
