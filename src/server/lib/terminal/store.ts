/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The terminal registry's process-wide state, anchored to `globalThis`.
 *
 * `bun run --hot` re-evaluates the terminal modules on every server-file edit,
 * while the PTY children are detached sessions that keep running. A
 * module-local `Map` would be replaced by a fresh empty one on each reload,
 * leaving the previous shells alive with nothing tracking them: unreachable from
 * the client, never counted, never reaped, still holding their slots. Anchoring
 * the state to the process keeps a reload from orphaning anything.
 *
 * The in-flight map has to live here for the same reason, one step further: a
 * reload that dropped it would let the next `attach` start a second creation
 * for an id whose first creation is still awaiting — exactly the race the map
 * exists to prevent. `sweep` survives a reload too, or every generation would
 * start its own reaper.
 */

import type { TerminalSession } from '@/server/lib/terminal/session.server';

/** Handle for a pending resize timeout. */
export type TerminalTimeout = ReturnType<typeof setTimeout>;
/** Handle for the idle reaper's interval. */
export type TerminalSweep = ReturnType<typeof setInterval>;

export interface TerminalStore {
  /** One record per terminal id, live or exited-but-still-watched. */
  sessions: Map<string, TerminalSession>;
  /** One in-flight `createSession` per terminal id. See the module doc. */
  creating: Map<string, Promise<TerminalSession>>;
  /** Debounced resize timeouts, keyed by terminal id. */
  resizeTimers: Map<string, TerminalTimeout>;
  /** The reaper, or undefined when it was never started. */
  sweep: TerminalSweep | undefined;
  /** Process-exit cleanup is registered once per process, not per reload. */
  cleanupInstalled: boolean;
}

declare global {
  // eslint-disable-next-line no-var
  var __kabmoTerminalState: TerminalStore | undefined;
  /**
   * The pre-object shape: a bare sessions Map under its own key. Read once, so a
   * server that reloads into this module keeps the shells it is already running
   * instead of dropping their records on the floor.
   */
  // eslint-disable-next-line no-var
  var __kabmoTerminals: Map<string, TerminalSession> | undefined;
  // eslint-disable-next-line no-var
  var __kabmoTerminalSweep: TerminalSweep | undefined;
  // eslint-disable-next-line no-var
  var __kabmoTerminalResizes: Map<string, TerminalTimeout> | undefined;
  // eslint-disable-next-line no-var
  var __kabmoTerminalCleanupInstalled: boolean | undefined;
}

export function terminalStore(): TerminalStore {
  if (globalThis.__kabmoTerminalState) return globalThis.__kabmoTerminalState;
  const legacySessions = globalThis.__kabmoTerminals;
  const legacyResizes = globalThis.__kabmoTerminalResizes;
  return (globalThis.__kabmoTerminalState = {
    sessions: legacySessions instanceof Map ? legacySessions : new Map(),
    creating: new Map(),
    resizeTimers: legacyResizes instanceof Map ? legacyResizes : new Map(),
    sweep: globalThis.__kabmoTerminalSweep,
    cleanupInstalled: globalThis.__kabmoTerminalCleanupInstalled === true,
  });
}
