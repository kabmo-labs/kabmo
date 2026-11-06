/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The harness a spawn was DISPATCHED with, keyed by the id the spawn answered.
 *
 * The sidebar's row is the durable answer (`harness_sessions`, written by the
 * server), but it lags a fresh spawn: the row appears on the next folder read,
 * which the spawn only signals. Without this record the first seconds of a new
 * chat had no harness at all, so the generating indicator fell back to the
 * generic robot exactly while the run the user just started was streaming —
 * and a chat that spawned on `opencode` announced itself as omp.
 *
 * A map rather than component state for the same reason `pending-sessions.ts`
 * is one: the fact is written by the send path and read by a surface that is
 * not its ancestor. Bounded by the spawns this page performed, and superseded
 * by the row the moment the sidebar carries it.
 */

const spawnedHarness = new Map<string, string>();

/** Record what a spawn was actually asked to run. Called before the URL adopts
 *  the new id, so the render that first sees that id reads it. */
export function recordSpawnHarness(sessionId: string, harness: string | null | undefined): void {
  if (!sessionId || !harness) return;
  spawnedHarness.set(sessionId, harness);
}

/** The harness recorded for a session, or undefined for one this page did not
 *  spawn (a reloaded chat, another tab's spawn). */
export function spawnedHarnessFor(sessionId: string | null | undefined): string | undefined {
  return sessionId ? spawnedHarness.get(sessionId) : undefined;
}

/** Forget everything: a test file starts cold, and `bun --hot` re-evaluates
 *  modules while the old map may describe spawns from the previous build. */
export function resetSpawnHarness(): void {
  spawnedHarness.clear();
}
