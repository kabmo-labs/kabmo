/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The scheduled-task runtime: one process-wide tick that claims every task due
 * and dispatches its prompt into omp.
 *
 * omp has no scheduler, so Kabmo owns both the clock and the dispatch.
 * A fire spawns an omp child through the same registry the chat uses —
 * `startNewRpcSession` for a fresh conversation, `startRpcSession` when the
 * task resumes a named session — and sends the prompt with the task's own model
 * snapshot, exactly the way a queued follow-up is delivered. Nothing here
 * bypasses the normal spawn path, so an approval mode, the idle reaper and the
 * stream-status row all behave as they do for a user-initiated prompt.
 *
 * A task is claimed BEFORE it is dispatched (see `claimDueTasks`), so a slow or
 * failing run can never be claimed twice by a later tick, and a `once` task is
 * spent even when its dispatch failed. The run record is what reports that.
 *
 * Anchored on `globalThis` for the same reason the database handle is: a
 * `bun --hot` module re-evaluation would otherwise leave the previous
 * `setInterval` running against a stale closure, and every save would add one
 * more tick.
 */

import { startNewRpcSession, startRpcSession, resolveSpawnCwd } from '@/server/lib/omp/rpc/manager';
import { resolveSessionPathOr404 } from '@/server/lib/omp/session/locator';
import { startAcpSession, type AcpSpawnRequest } from '@/server/lib/harness/spawn.server';
import { loadHarnessSession } from '@/server/lib/harness/session-store.server';
import { loadPersistedAccessMode } from '@/shared/lib/omp/config/access-mode.server';
import { claimDueTasks, finishScheduledRun, startScheduledRun } from '@/server/lib/schedule/store.server';
import type { ApprovalMode } from '@/shared/lib/omp/config/access-mode';
import type { HarnessId } from '@/shared/lib/harness/catalog';
import type { ScheduledTask } from '@/shared/types/schedule';

/**
 * How often the clock is consulted. The shortest schedulable interval is one
 * minute, so a 20s tick bounds a fire's lateness at 20s while costing one
 * indexed query on an idle database.
 */
const TICK_MS = 20_000;

/** Delay before the first tick: boot work (schema, watchers, the port lock)
 *  owns the first seconds, and a task that came due while the server was down
 *  is in no hurry to fire 200 ms into startup. */
const FIRST_TICK_DELAY_MS = 5_000;

/**
 * How long a single dispatch may take before the run is recorded as an error
 * and the child is abandoned. A spawn plus a prompt ack is seconds; this only
 * bounds a child that never answers at all, so one stuck task cannot hold the
 * tick — and every task behind it — for the process's lifetime.
 */
const DISPATCH_TIMEOUT_MS = 180_000;

/** The prompt-sending surface a dispatch needs from an omp child. Narrower than
 *  the session wrapper on purpose: a test can drive the whole dispatch path
 *  without spawning a process or opening the database. */
export interface ScheduleSessionHandle {
  send(command: Record<string, unknown>): Promise<unknown>;
}

/**
 * Everything a fire reaches outside this module. Injected rather than imported
 * at the call site for two reasons: the store and the spawn path are both
 * process-wide singletons that a test must be able to replace, and doing it
 * through `mock.module` would swap the module registry entry for every OTHER
 * test file in the same `bun test` run (measured: mocking the RPC manager here
 * broke six unrelated suites with "Export named ... not found").
 */
export interface ScheduleDeps {
  startNewRpcSession(cwd: string, mode?: ApprovalMode): Promise<{ session: ScheduleSessionHandle; realSessionId: string }>;
  startRpcSession(
    sessionId: string,
    sessionFile: string,
    cwd: string,
    recordedCwd?: string | null,
    mode?: ApprovalMode,
  ): Promise<{ session: ScheduleSessionHandle; realSessionId: string }>;
  resolveSpawnCwd(recordedCwd?: string | null): Promise<string>;
  resolveSessionPathOr404(sessionId: string): Promise<{ filePath: string; recordedCwd: string | null } | { response: Response }>;
  /** Start an ACP session for a task whose harness is not the built-in RPC. */
  startAcpSession(request: AcpSpawnRequest): Promise<{ session: ScheduleSessionHandle; realSessionId: string }>;
  /** The agent's own session id, for resuming an ACP chat. */
  loadHarnessSession(sessionId: string): Promise<{ harness: string; agentSessionId: string } | null>;
  loadPersistedAccessMode(): Promise<ApprovalMode>;
  claimDueTasks(now: number): Promise<ScheduledTask[]>;
  startScheduledRun(taskId: string, sessionId: string | null): Promise<string>;
  finishScheduledRun(
    runId: string,
    taskId: string,
    status: 'success' | 'error',
    detail: string,
    options?: { sessionId?: string | null; countRun?: boolean },
  ): Promise<void>;
}

const defaultDeps: ScheduleDeps = {
  startNewRpcSession,
  startRpcSession,
  resolveSpawnCwd,
  resolveSessionPathOr404,
  startAcpSession,
  loadHarnessSession,
  loadPersistedAccessMode,
  claimDueTasks,
  startScheduledRun,
  finishScheduledRun,
};

interface ScheduleRuntimeSlot {
  timer: NodeJS.Timeout | null;
  /** In-flight tick, so a slow dispatch does not overlap the next interval. */
  ticking: boolean;
  /**
   * Runs in flight, keyed by task id. A manual "Run now" is refused while one
   * is present: a second click would spawn a second omp session for the same
   * prompt. A scheduled fire is NOT refused — the claim already advanced its
   * clock, so skipping it would lose the fire.
   */
  running: Map<string, number>;
}

declare global {
  // eslint-disable-next-line no-var
  var __kabmoScheduleRuntime: ScheduleRuntimeSlot | undefined;
}

function slot(): ScheduleRuntimeSlot {
  return (globalThis.__kabmoScheduleRuntime ??= { timer: null, ticking: false, running: new Map() });
}

/** Whether a run for this task is in flight right now. */
export function isTaskRunning(id: string): boolean {
  return (slot().running.get(id) ?? 0) > 0;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Open an ACP session for a task whose harness is not the built-in RPC.
 *
 * A task that names a session resumes it only when the recorded row belongs to
 * the SAME harness: an omp session id means nothing to `claude`, and asking the
 * agent to load it would fail the run. A missing or foreign row starts a fresh
 * conversation, which is the same fallback the RPC path uses for a pruned file.
 */
async function openAcpTarget(
  task: ScheduledTask,
  deps: ScheduleDeps,
  mode: ApprovalMode,
): Promise<{ session: ScheduleSessionHandle; sessionId: string; note: string }> {
  const cwd = await deps.resolveSpawnCwd(task.cwd);
  let resumeAgentSessionId: string | undefined;
  let note = 'new session';

  if (task.sessionId) {
    const recorded = await deps.loadHarnessSession(task.sessionId);
    if (recorded && recorded.harness === task.harness && recorded.agentSessionId) {
      resumeAgentSessionId = recorded.agentSessionId;
      note = 'resumed session';
    } else {
      note = 'session not found; started a new one';
    }
  }

  const { session, realSessionId } = await deps.startAcpSession({
    harness: task.harness as HarnessId,
    sessionId: `__new__${crypto.randomUUID()}`,
    cwd,
    model: task.model ? { provider: task.model.provider, modelId: task.model.modelId } : null,
    thinkingLevel: task.model?.thinkingLevel ?? null,
    accessMode: mode,
    ...(resumeAgentSessionId ? { resumeAgentSessionId } : {}),
  });
  return { session, sessionId: realSessionId, note };
}

/**
 * Resolve the child a fire should drive, and the prompt to send.
 *
 * A task with `sessionId` RESUMES that conversation, so "every morning, in this
 * thread" keeps one transcript. A missing file falls back to a fresh session
 * rather than failing the run: the id may name a session that was deleted or
 * pruned, and the task's prompt is still worth running.
 */
async function openDispatchTarget(
  task: ScheduledTask,
  deps: ScheduleDeps,
): Promise<{ session: ScheduleSessionHandle; sessionId: string; note: string }> {
  const mode = task.model?.accessMode ?? (await deps.loadPersistedAccessMode());

  if (task.harness && task.harness !== 'omp-rpc') {
    return openAcpTarget(task, deps, mode);
  }

  if (task.sessionId) {
    const resolved = await deps.resolveSessionPathOr404(task.sessionId);
    if (!('response' in resolved)) {
      const cwd = await deps.resolveSpawnCwd(resolved.recordedCwd ?? task.cwd);
      const { session, realSessionId } = await deps.startRpcSession(
        task.sessionId,
        resolved.filePath,
        cwd,
        resolved.recordedCwd,
        mode,
      );
      return { session, sessionId: realSessionId, note: 'resumed session' };
    }
  }

  const cwd = await deps.resolveSpawnCwd(task.cwd);
  const { session, realSessionId } = await deps.startNewRpcSession(cwd, mode);
  return {
    session,
    sessionId: realSessionId,
    note: task.sessionId ? 'session not found; started a new one' : 'new session',
  };
}

/**
 * Dispatch one task. Never throws: the caller is a timer, and a rejected
 * promise there would be an unhandled rejection with nothing to retry.
 */
export async function runScheduledTask(
  task: ScheduledTask,
  options: { manual?: boolean; deps?: ScheduleDeps } = {},
): Promise<string> {
  const deps = options.deps ?? defaultDeps;
  const state = slot();
  // Backstop for the route's own check: a manual run never overlaps another
  // run of the same task.
  if (options.manual && isTaskRunning(task.id)) return '';
  state.running.set(task.id, (state.running.get(task.id) ?? 0) + 1);
  try {
    const runId = await deps.startScheduledRun(task.id, task.sessionId);
    try {
      const target = await withTimeout(openDispatchTarget(task, deps), DISPATCH_TIMEOUT_MS, 'The omp process did not start in time.');
      // An ACP session applies the model and thinking picks during its
      // handshake; sending them again would ask an agent that may publish no
      // such selector, and the spawn already refused a model it does not list.
      if (task.harness === 'omp-rpc' && task.model) {
        await target.session.send({ type: 'set_model', provider: task.model.provider, modelId: task.model.modelId });
        if (task.model.thinkingLevel !== 'auto') {
          await target.session.send({ type: 'set_thinking_level', level: task.model.thinkingLevel });
        }
      }
      await withTimeout(
        target.session.send({ type: 'prompt', message: task.prompt }),
        DISPATCH_TIMEOUT_MS,
        'The omp session did not accept the prompt in time.',
      );
      const detail = options.manual ? `Ran now (${target.note})` : target.note;
      await deps.finishScheduledRun(runId, task.id, 'success', detail, {
        sessionId: target.sessionId,
        countRun: !options.manual,
      });
      return target.sessionId;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await deps.finishScheduledRun(runId, task.id, 'error', message, { countRun: !options.manual });
      return '';
    }
  } finally {
    const remaining = (state.running.get(task.id) ?? 1) - 1;
    if (remaining > 0) state.running.set(task.id, remaining);
    else state.running.delete(task.id);
  }
}

/**
 * One pass of the clock: claim everything due, then dispatch it in order.
 *
 * Serial on purpose — the claim already moved every task's schedule, so there
 * is nothing to lose by running them one at a time, and a burst of ten tasks
 * spawning ten omp children at once would fight over the same CPU the first
 * one needs to boot.
 */
export async function tickSchedules(now = Date.now()): Promise<number> {
  const due = await claimDueTasks(now);
  for (const task of due) await runScheduledTask(task);
  return due.length;
}

/** Start the tick. Idempotent: a second call is a no-op while one is running. */
export function startScheduleRuntime(): void {
  const state = slot();
  if (state.timer) return;
  const tick = () => {
    if (state.ticking) return;
    state.ticking = true;
    tickSchedules()
      .catch((error) => console.error('[schedule] tick failed:', error))
      .finally(() => {
        state.ticking = false;
      });
  };
  setTimeout(tick, FIRST_TICK_DELAY_MS).unref();
  state.timer = setInterval(tick, TICK_MS);
  // A timer must never hold the process open: the server's own listener is what
  // keeps it alive, and a shutdown should not wait for the next tick.
  state.timer.unref();
}

/** Stop the tick (shutdown, tests). */
export function stopScheduleRuntime(): void {
  const state = slot();
  // The guard is not redundant here: the handle is nulled after the clear, so
  // the branch does more than clear (and the typing refuses a null id anyway).
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
}
