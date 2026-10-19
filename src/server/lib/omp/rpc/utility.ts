/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared short-lived `omp` utility process for global registry/auth queries
 * (get_available_models, get_login_providers, get_state). These commands do
 * not belong to any user session, so they run against a single lazily-started
 * RPC process that is killed after ~300s of inactivity. Access is serialized:
 * the omp RPC loop handles one command at a time anyway, and serialization
 * lets lazy start/idle-kill stay race-free.
 *
 * Real user sessions must use lib/rpc-manager.ts instead — this process runs
 * with --no-session and its agent state is throwaway.
 *
 * Faithful port of omp-web/lib/omp/rpc-utility.ts.
 */

import { homedir } from 'os';
import { RpcProcess } from '@/server/lib/omp/rpc/process';
import { RELOAD_PLUGINS_TIMEOUT_MS } from '@/server/lib/omp/rpc/constants';

// Extensions stay ENABLED: they can register models and login providers, and
// omitting them made the web UI's model/provider lists disagree with the CLI's.
//
// Skills stay ENABLED too. `--no-skills` made `get_available_commands` omit
// every `skill:<name>` entry (measured: 45 commands without, 52 with), so the
// composer's `/` popup could not offer the skills omp happily executes — and
// Kabmo's own disk scan missed provider roots omp reads (`~/.agents/skills`).
// Cost is nil: the ready frame lands at the same ~420ms either way.
const UTILITY_EXTRA_ARGS = ['--no-session', '--no-lsp'];
const READY_TIMEOUT_MS = 60_000;
// Longer than the 60s models-cache TTL on purpose: with idle-kill == TTL every
// pause past a minute paid a cold multi-second respawn on top of the stale
// cache. Cost of the longer window is one idle omp process.
const IDLE_KILL_MS = 300_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 60_000;

/** Minimal mirror of omp's Model — only the fields the models/auth routes
 * read. Everything else passes through opaque. */
export interface OmpModel {
  id: string;
  name: string;
  provider: string;
  api?: string;
  reasoning?: boolean;
  thinking?: {
    mode?: string;
    efforts?: string[];
    defaultLevel?: string;
    effortMap?: Record<string, string>;
  };
  input?: string[];
  contextWindow?: number | null;
  maxTokens?: number | null;
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
}

/** Entry of the get_login_providers response (modes/rpc/rpc-types.ts). */
export interface OmpLoginProvider {
  id: string;
  name: string;
  available: boolean;
  authenticated: boolean;
}

interface UtilityRpcState {
  proc: RpcProcess | null;
  idleTimer: NodeJS.Timeout | null;
  queue: Promise<void>;
}

declare global {
  // eslint-disable-next-line no-var
  var __ompUtilityRpcStates: Map<string, UtilityRpcState> | undefined;
}

/**
 * Utility processes are pooled PER WORKING DIRECTORY, because a cwd is not just
 * a spawn detail: omp resolves project-scope config from it. `.omp/commands`,
 * `.omp/skills`, `.claude`, `.agents` and `AGENTS.md` in a workspace are only
 * discovered by a child started in that workspace (measured: a child in $HOME
 * reported 7 skill entries and one `file` command; the same child in a repo
 * reported 9 and the repo's own command). One process per cwd keeps the global
 * registry queries (`get_available_models`, `get_login_providers`) on the
 * cheap home-scoped child while letting a workspace-scoped read see its own
 * project config. Each pool entry is idle-killed on its own timer.
 */
function getState(cwd: string): UtilityRpcState {
  if (!globalThis.__ompUtilityRpcStates) {
    globalThis.__ompUtilityRpcStates = new Map();
    // Dispose every pooled process on server shutdown so none outlives the
    // server. Idempotent and safe to call any time.
    const cleanup = () => disposeUtilityRpc();
    process.once('exit', cleanup);
    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);
  }
  const states = globalThis.__ompUtilityRpcStates;
  let state = states.get(cwd);
  if (!state) {
    state = { proc: null, idleTimer: null, queue: Promise.resolve() };
    states.set(cwd, state);
  }
  return state;
}

/**
 * Tear down the shared utility omp processes immediately (skip the idle
 * timers). Safe to call any time — it just clears any pending idle kill and
 * disposes the live children.
 */
export function disposeUtilityRpc(): void {
  const states = globalThis.__ompUtilityRpcStates;
  if (!states) return;
  for (const state of states.values()) {
    if (state.idleTimer) {
      clearTimeout(state.idleTimer);
      state.idleTimer = null;
    }
    const proc = state.proc;
    state.proc = null;
    if (proc) void proc.dispose();
  }
  states.clear();
}

/**
 * Ask every pooled utility child to re-read its skill/command roots.
 *
 * These children answer `get_available_commands` for the composer's `/` popup
 * and the settings panes, and they are pooled for up to {@link IDLE_KILL_MS},
 * so without this a skill written now stays invisible in the popup for minutes
 * after every session has already picked it up. Only a LIVE process is asked —
 * a pooled entry with no child has nothing cached and will discover the current
 * files on its next lazy start.
 *
 * Serialized on each pool's own queue like every other command, so it can never
 * interleave with a `get_available_commands` in flight. Best-effort per cwd.
 */
export async function reloadUtilityProcesses(): Promise<void> {
  const states = globalThis.__ompUtilityRpcStates;
  if (!states || states.size === 0) return;
  await Promise.all(
    [...states.entries()].map(async ([cwd, state]) => {
      const proc = state.proc;
      if (!proc || !proc.isAlive) return;
      try {
        await runUtilityCommand({ type: 'prompt', message: '/reload-plugins' }, RELOAD_PLUGINS_TIMEOUT_MS, cwd);
      } catch (error) {
        console.error(`Failed to reload plugins for pooled utility process (${cwd}):`, error);
      }
    }),
  );
}

/**
 * Recycle every pooled utility child: dispose the live process and let the next
 * command spawn a fresh one from the current binary.
 *
 * A pooled child is spawned once and then answers registry queries for up to
 * {@link IDLE_KILL_MS} — so after `omp update` replaces the binary, the provider
 * list, the model list and the composer's `/` popup keep being served by the
 * OLD build until the idle kill happens to fire. Disposing is enough to fix
 * that: the pool's whole contract is lazy start, so "no child" is a normal
 * state and the next `get_login_providers` boots the new binary.
 *
 * Serialized on each pool's own queue, so a command already in flight finishes
 * on the child it started on rather than being killed mid-response. Returns how
 * many live children were recycled (an idle-killed pool entry has nothing to
 * dispose).
 */
export async function restartUtilityProcesses(): Promise<number> {
  const states = globalThis.__ompUtilityRpcStates;
  if (!states || states.size === 0) return 0;
  let recycled = 0;
  await Promise.all(
    [...states.values()].map(async (state) => {
      const run = state.queue.then(async () => {
        if (state.idleTimer) {
          clearTimeout(state.idleTimer);
          state.idleTimer = null;
        }
        const proc = state.proc;
        state.proc = null;
        if (!proc) return;
        recycled += 1;
        await proc.dispose();
      });
      state.queue = run.then(
        () => undefined,
        () => undefined,
      );
      await run;
    }),
  );
  return recycled;
}

function scheduleIdleKill(state: UtilityRpcState): void {
  if (state.idleTimer) clearTimeout(state.idleTimer);
  state.idleTimer = setTimeout(() => {
    state.idleTimer = null;
    const proc = state.proc;
    state.proc = null;
    if (proc) void proc.dispose();
  }, IDLE_KILL_MS);
  state.idleTimer.unref?.();
}

async function startProcess(state: UtilityRpcState, cwd: string): Promise<RpcProcess> {
  const proc = new RpcProcess({
    cwd,
    extraArgs: UTILITY_EXTRA_ARGS,
    onExit: () => {
      if (state.proc === proc) state.proc = null;
    },
  });
  try {
    const ready = await proc.waitReady(READY_TIMEOUT_MS);
    await proc.negotiateProtocol(ready);
  } catch (error) {
    void proc.dispose();
    throw error;
  }
  return proc;
}

/** Run one RPC command on the shared utility process (lazy start, serialized,
 * idle-killed). Rejections from earlier commands never poison the queue.
 * `cwd` scopes discovery to a workspace; omitted, the child runs in $HOME. */
export function runUtilityCommand<T = unknown>(
  command: { type: string; [key: string]: unknown },
  timeoutMs: number = DEFAULT_COMMAND_TIMEOUT_MS,
  cwd: string = homedir(),
): Promise<T> {
  const state = getState(cwd);
  const run = state.queue.then(async () => {
    if (state.idleTimer) {
      clearTimeout(state.idleTimer);
      state.idleTimer = null;
    }
    try {
      if (!state.proc || !state.proc.isAlive) {
        state.proc = await startProcess(state, cwd);
      }
      return await state.proc.sendCommand<T>(command, timeoutMs);
    } finally {
      scheduleIdleKill(state);
    }
  });
  state.queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Run one RPC command on a dedicated throwaway process. Used where the shared
 * process must not be reused — e.g. a connectivity test that points
 * PI_CODING_AGENT_DIR at a temp dir via `env`.
 *
 * `signal` (optional) aborts the whole lifecycle: a not-yet-ready child is
 * disposed immediately and a pending command is rejected. Callers with a
 * Request should pass `request.signal` so a disconnected client does not keep
 * a 60s registry spawn running. */
export async function runIsolatedUtilityCommand<T = unknown>(
  command: { type: string; [key: string]: unknown },
  options: { env?: Record<string, string>; cwd?: string; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<T> {
  const proc = new RpcProcess({
    cwd: options.cwd ?? homedir(),
    extraArgs: UTILITY_EXTRA_ARGS,
    env: options.env,
  });
  const signal = options.signal;
  const onAbort = () => { void proc.dispose(); };
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    const ready = await proc.waitReady(READY_TIMEOUT_MS);
    await proc.negotiateProtocol(ready);
    return await proc.sendCommand<T>(command, options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS);
  } catch (error) {
    if (signal?.aborted) {
      throw new Error('Request aborted');
    }
    throw error;
  } finally {
    if (signal) signal.removeEventListener('abort', onAbort);
    // Await the child's exit (not fire-and-forget): callers like a config test
    // remove their throwaway temp dir right after this resolves, and on
    // Windows a still-exiting child holding handles on that dir makes rmSync
    // fail (EBUSY, only suppressed by force: true).
    await proc.dispose();
  }
}
