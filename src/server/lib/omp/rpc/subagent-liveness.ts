/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Liveness of a session's subagents, folded from the frames the wrapper already
 * receives (`set_subagent_subscription` in AgentSessionWrapper.initialize).
 *
 * Every other "this session is working" flag on the wrapper (promptRunning /
 * streaming / compacting / bashRunning) is blind to subagents: a parent turn
 * can end — or a detached subagent outlive it — while subagents keep working,
 * and a frame-silent subagent otherwise looks exactly like an idle session to
 * the idle reaper. Used only for lifecycle decisions (idle reclaim, spawn-mode
 * reconcile), never for the UI's running set.
 *
 * Identity mirrors the UI fold (`SubagentList`): frames carry an id, a
 * lifecycle may also carry `index`, and progress frames may be id-less and are
 * then matched by index — hence the index→key alias, so one subagent is never
 * tracked under two keys (a leftover key would pin the session alive until it
 * goes stale).
 */

import { parseSubagentLifecycle, readSubagentProgressFrame } from '@/shared/lib/omp/subagent/parse';

/** Statuses that end a subagent. Mirrors omp's own registry, which deletes an
 *  entry the moment a non-`started` lifecycle arrives. */
const TERMINAL_STATUS: Record<string, true> = { completed: true, failed: true, aborted: true };

export class SubagentLiveness {
  private readonly lastSeen = new Map<string, number>();
  /** index → key, so an id-less progress frame lands on the entry its lifecycle
   *  created instead of opening a second one. */
  private readonly keyByIndex = new Map<number, string>();

  /** Fold one `subagent_lifecycle|subagent_progress|subagent_event` frame. */
  observe(frame: { type: string; payload?: unknown }, now: number): void {
    if (frame.type === 'subagent_lifecycle') {
      const entry = parseSubagentLifecycle(frame.payload);
      if (!entry) return;
      if (TERMINAL_STATUS[entry.status] === true) this.forget(entry.id);
      else this.mark(entry.id, entry.index >= 0 ? entry.index : undefined, now);
      return;
    }

    if (frame.type === 'subagent_progress') {
      const progress = readSubagentProgressFrame(frame.payload);
      if (!progress) return;
      const index = progress.index !== undefined && progress.index >= 0 ? progress.index : undefined;
      const key = progress.id ?? (index !== undefined ? this.keyByIndex.get(index) ?? `idx:${index}` : undefined);
      if (key === undefined) return;
      if (progress.status !== undefined && TERMINAL_STATUS[progress.status] === true) this.forget(key);
      else this.mark(key, index, now);
      return;
    }

    if (frame.type === 'subagent_event') {
      // An event proves *some* subagent is working but carries no identity of
      // its own: refresh what is already tracked, and never invent an entry —
      // an invented one could never be cleared by a terminal frame.
      for (const key of this.lastSeen.keys()) this.lastSeen.set(key, now);
    }
  }

  /** Live subagents as of `now`. Entries silent past `staleMs` are dropped
   *  first: a terminal frame lost to a protocol hiccup must not pin a session
   *  alive forever (the price of the window is at most one idle omp process). */
  liveCount(now: number, staleMs: number): number {
    for (const [key, lastSeen] of this.lastSeen) {
      if (now - lastSeen > staleMs) this.forget(key);
    }
    return this.lastSeen.size;
  }

  /**
   * Drop the whole roster. Called when omp itself reports the session quiescent
   * (`isSettled: true`), which is authoritative proof that no subagent is still
   * working — a terminal frame lost to a protocol hiccup otherwise kept this
   * roster non-empty and the session reading as busy for the full stale window.
   */
  clear(): void {
    this.lastSeen.clear();
    this.keyByIndex.clear();
  }

  private mark(key: string, index: number | undefined, now: number): void {
    this.lastSeen.set(key, now);
    if (index === undefined) return;
    // A lifecycle naming the same index supersedes the synthetic key an earlier
    // id-less progress frame created for it.
    if (key !== `idx:${index}`) this.lastSeen.delete(`idx:${index}`);
    this.keyByIndex.set(index, key);
  }

  private forget(key: string): void {
    this.lastSeen.delete(key);
    for (const [index, alias] of this.keyByIndex) {
      if (alias === key) this.keyByIndex.delete(index);
    }
  }
}
