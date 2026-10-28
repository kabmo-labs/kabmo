/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Test harness for the session command dispatcher: a fake host and process that
 * record what a command mapping did. Split from `session-commands.test.ts` so
 * that suite stays under the repo's per-file size ceiling.
 */

import type { SessionCommandHost } from '@/server/lib/omp/rpc/session-commands';
import type { RpcProcess } from '@/server/lib/omp/rpc/process';
import type { AgentEvent } from '@/server/lib/omp/rpc/constants';

export interface CommandHarness {
  host: SessionCommandHost;
  calls: Record<string, unknown>[];
  frames: Record<string, unknown>[];
  events: AgentEvent[];
  respond: (next: (command: Record<string, unknown>) => unknown) => void;
  counters: { idleResets: number; watchdogs: number; destroys: number; resolvedDialogs: string[] };
  /** Blocking dialogs the host reports. Push one to simulate a parked child. */
  pendingDialogs: unknown[];
}

export function makeHarness(overrides: Record<string, unknown> = {}): CommandHarness {
  const calls: Record<string, unknown>[] = [];
  const frames: Record<string, unknown>[] = [];
  const events: AgentEvent[] = [];
  const counters = { idleResets: 0, watchdogs: 0, destroys: 0, resolvedDialogs: [] as string[] };
  const pendingDialogs: unknown[] = [];
  let handler: (command: Record<string, unknown>) => unknown = () => undefined;
  const proc = {
    // Deferred by a microtask so a handler that THROWS rejects the returned
    // promise (as the real RPC process does) instead of throwing synchronously.
    async sendCommand(command: Record<string, unknown>) {
      calls.push(command);
      await Promise.resolve();
      return handler(command);
    },
    sendFrame(frame: Record<string, unknown>) {
      frames.push(frame);
    },
  } as unknown as RpcProcess;
  const host = {
    streaming: false,
    compacting: false,
    promptRunning: false,
    promptDispatchPendingCount: 0,
    awaitingAgentStart: false,
    awaitingAgentStartDeadline: 0,
    continuationGraceUntil: 0,
    bashRunning: false,
    fastModeEnabled: false,
    restarting: false,
    sessionId: 'sess-1',
    proc,
    isAlive: () => true,
    isRunning: () => false,
    isBusy: () => false,
    emit: (event: AgentEvent) => events.push(event),
    send: async () => undefined,
    idle: { reset: () => { counters.idleResets += 1; } },
    resolvePendingUiDialog: (id: string) => { counters.resolvedDialogs.push(id); },
    getPendingUiDialogs: () => pendingDialogs,
    armAgentStartWatchdog: () => { counters.watchdogs += 1; },
    destroyAndWait: async () => { counters.destroys += 1; },
    adoptSessionIdentity: () => {},
    ...overrides,
  } as unknown as SessionCommandHost;
  return {
    host,
    calls,
    frames,
    events,
    respond: (next: (command: Record<string, unknown>) => unknown) => { handler = next; },
    counters,
    pendingDialogs,
  };
}

/** Resolve to the rejection value, or null when the operation resolved. */
export async function rejectionOf(operation: Promise<unknown>): Promise<unknown> {
  return operation.then(() => null, (error: unknown) => error);
}
