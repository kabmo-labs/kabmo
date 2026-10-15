/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Sessions this process is streaming WITHOUT an omp child.
 *
 * A `stream` row records the pid of the chamber process running it, and the
 * sidebar's self-heal releases any row this process owns while its RPC
 * registry holds no run for it (`isOrphanStreamRow`). That rule is correct for
 * every run an omp child serves — and wrong for the simulated stream, whose run
 * lives in the SSE route itself. Without a way to say "this one is mine, and it
 * is running", the row the mock route writes is healed to `finish` on the very
 * next sidebar load and the spinner dies mid-answer.
 *
 * One accessor rather than add/remove/has wrappers: the callers are three lines
 * apart in `routes/chat/stream.ts` and the sidebar's live-run read, and a
 * `Set`'s own API says what each one means.
 *
 * Deliberately import-free, like `realtime/signals.server.ts`: the module that
 * reads this set (`rpc/session-registry.ts`) sits above the RPC layer, and a
 * registry module that pulled in the database or the realtime hub would close
 * a cycle.
 *
 * Anchored on `globalThis` for the reason the database handle is: `bun --hot`
 * re-evaluates a changed module in place, and a module-level `Set` would be
 * reset to empty while the streams it describes are still running.
 */

const SLOT = '__ompChamberLocalRuns';

/** The live set, created on first use. Callers `add`/`delete`/spread it. */
export function localRuns(): Set<string> {
  const holder = globalThis as unknown as Record<string, Set<string> | undefined>;
  if (!holder[SLOT]) holder[SLOT] = new Set();
  return holder[SLOT];
}
