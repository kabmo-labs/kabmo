/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The run registry: spawn, follow, stop.
 *
 * ## Why this is not the terminal panel
 *
 * `src/server/lib/terminal/` owns one PTY per terminal id with a real shell and
 * scrollback. A command typed there cannot answer "what was this run's exit
 * code", cannot list the runs, and would make a repo switch reason about a user's
 * interactive shell. So this owns its own children: `Bun.spawn`, a pipe per run,
 * a process GROUP per run.
 *
 * ## The three mechanics that matter, each measured
 *
 * - **`detached: true` is what creates the group**, and `process.kill(-pid, SIG)`
 *   is what kills the whole tree — measured: a `sh -c 'echo one; sleep 0.2; echo
 *   two; sleep 5'` spawned detached, killed after 600 ms, yielded `"one\ntwo\n"`
 *   with `signalCode: 'SIGKILL'`. Without `detached` the kill would reach the
 *   shell and leave its children.
 * - **A killed child reports `exitCode: null` and a SIGNAL**, never a code. So
 *   the summary carries `signal` and the view must not read a null code as
 *   `exit 0` — that would report a killed run as a success.
 * - **A missing binary THROWS from `Bun.spawn`** rather than producing a child
 *   with a non-zero code, so the try/catch is the only path that reports it.
 *
 * ## The buffer is a ring, and the total is kept separately
 *
 * A build can produce megabytes and the panel shows a tail, so the ring holds the
 * last `RUN_BUFFER_BYTES` while `bytes` counts everything the process produced.
 * The two numbers are what let the view say "the last 64 KB of 3.1 MB" instead of
 * presenting a window as the whole log.
 *
 * ## Nothing here is persisted
 *
 * A plugin reload, a disable or a chamber restart ends every run. The shutdown
 * path disposes this registry (the plugin's `onDispose`), which is what keeps a
 * detached child from outliving the server.
 */

import type { RunStatus, RunSummary, RunnerState } from '../protocol';
import { ringText } from './ring';
import { killGroup } from './kill';
import type { Run, RunnerDeps } from './run-types';

/** How long a graceful stop waits before the kill. */
const STOP_GRACE_MS = 1500;


/** The scope key a run belongs to. */
export function scopeKeyOf(root: string, repo: string): string {
  return `${root}\0${repo}`;
}

/**
 * The registry.
 *
 * One instance per plugin load. `onDispose` kills everything, which is what makes
 * a plugin reload or a server shutdown safe.
 */
export class RunStore {
  /** The runs, keyed by id. `protected` so the run half can reach them. */
  protected readonly runs = new Map<string, Run>();
  /** The runs in flight, so `stop-others` and disposal can sweep them. */
  /** What this registry needs from its host. `protected` for the run half. */
  protected readonly deps: RunnerDeps;

  constructor(deps: RunnerDeps) {
    this.deps = deps;
  }

  /** The state the topic carries: metadata only, never output. */
  state(): RunnerState {
    const runs = [...this.runs.values()].map((run) => this.summary(run));
    // Newest first, so a panel that just opened shows the live run at the top.
    runs.sort((a, b) => b.startedAt - a.startedAt);
    const newest = runs[0];
    return { scopeKey: newest?.scopeKey ?? null, runs };
  }

  protected summary(run: Run): RunSummary {
    return {
      id: run.id,
      sessionId: run.sessionId,
      scopeKey: run.scopeKey,
      commandId: run.commandId,
      file: run.file,
      label: run.label,
      background: run.background,
      status: run.status,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      exitCode: run.exitCode,
      signal: run.signal,
      bytes: run.bytes,
      ringBytes: run.ring.held,
      ...(run.error ? { error: run.error } : {}),
    };
  }

  /** One run's log tail, or null for an id this does not hold. */
  log(id: string, tail: number): {
    id: string;
    status: RunStatus;
    exitCode: number | null;
    signal: string | null;
    bytes: number;
    ringBytes: number;
    truncated: boolean;
    text: string;
  } | null {
    const run = this.runs.get(id);
    if (!run) return null;
    return {
      id: run.id,
      status: run.status,
      exitCode: run.exitCode,
      signal: run.signal,
      bytes: run.bytes,
      ringBytes: run.ring.held,
      truncated: run.bytes > run.ring.held,
      text: ringText(run.ring, tail),
    };
  }

  /** How many runs are in flight. */
  get runningCount(): number {
    let count = 0;
    for (const run of this.runs.values()) if (run.status === 'running') count += 1;
    return count;
  }

  /**
   * Stop one run.
   *
   * SIGTERM first so a tool can flush, then SIGKILL — the escalation is the
   * point: SIGTERM alone lets a wrapper that ignores it survive a "stop", and
   * SIGKILL alone gives a build no chance to write its log.
   */
  async stop(id: string): Promise<{ stopped: boolean }> {
    const run = this.runs.get(id);
    if (!run || !run.proc || run.status !== 'running') return { stopped: false };
    run.status = 'stopped';
    const pid = run.proc.pid;
    killGroup(pid, 'SIGTERM');
    // Published NOW, not left to `follow`: the reader clicked Stop and must see
    // the row leave `Running` at that moment. `follow` publishes again when the
    // exit lands, which is where the signal and the timing come from.
    this.deps.publish(this.state());
    const gate = Promise.withResolvers<void>();
    setTimeout(gate.resolve, STOP_GRACE_MS);
    await gate.promise;
    // Still alive after the grace: nothing is left to read a graceful exit.
    if (run.status === 'stopped' && run.proc && run.proc.exitCode === null) killGroup(pid, 'SIGKILL');
    return { stopped: true };
  }

  /**
   * Stop every run of a session whose scope is NOT the one given.
   *
   * Defined by the scope it is handed rather than by a diff, so calling it twice
   * — or calling it when nothing changed — is a no-op. That is what lets the
   * scope watcher fire on every notification instead of tracking the previous
   * scope, and it makes a missed notification self-healing.
   */
  async stopOthers(sessionId: string | null, scopeKey: string): Promise<{ stopped: number }> {
    let stopped = 0;
    for (const run of [...this.runs.values()]) {
      if (run.status !== 'running') continue;
      if (run.scopeKey === scopeKey) continue;
      if (run.sessionId !== sessionId) continue;
      await this.stop(run.id);
      stopped += 1;
    }
    return { stopped };
  }

  /**
   * Stop every running run of a session, whatever its scope.
   *
   * The per-command `Disable` and the panel's own "stop everything" both mean
   * "nothing of mine may keep running", so this spares no scope — which is the
   * one thing that separates it from `stopOthers` (a repo-switch sweep, which
   * must leave the repo the user just moved TO alone).
   */
  async stopAll(sessionId: string | null): Promise<{ stopped: number }> {
    let stopped = 0;
    for (const run of [...this.runs.values()]) {
      if (run.status !== 'running') continue;
      if (run.sessionId !== sessionId) continue;
      await this.stop(run.id);
      stopped += 1;
    }
    return { stopped };
  }

  /** Kill everything, for a plugin reload or the server's shutdown. */
  async dispose(): Promise<void> {
    for (const run of [...this.runs.values()]) {
      cancelPendingPublish(run);
      if (run.status !== 'running' || !run.proc) continue;
      // Straight to SIGKILL: there is nobody left to read a graceful exit.
      killGroup(run.proc.pid, 'SIGKILL');
      run.status = 'stopped';
    }
    this.runs.clear();
  }
}

/**
 * Cancel a run's coalesced publish.
 *
 * Lives here rather than on the run half because the SWEEP needs it — a disposal
 * that left a timer armed would publish into a registry that no longer holds the
 * run. The run half has its own copy of the same two lines; the alternative is
 * the store reaching up into its subclass.
 */
export function cancelPendingPublish(run: Run): void {
  if (run.publishTimer) {
    clearTimeout(run.publishTimer);
    run.publishTimer = null;
  }
}
