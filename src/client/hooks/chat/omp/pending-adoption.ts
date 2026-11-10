/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The pending → real id switch a spawn performs, and who may claim it.
 *
 * Split from the store (`pending-sessions.ts`) because the two readers ask
 * different questions of the same record: the session-state provider claims it
 * once to carry a draft across, while the agent hook only peeks to know the
 * conversation did not change. Neither may treat a plain session switch as an
 * adoption — that mistake copied one chat's draft into another and cleared the
 * run's tool map mid-turn.
 */

/** `toId → fromId` for a spawn adoption, written where the spawn answers. */
const adoptions = new Map<string, string>();

/** Record a spawn adoption; bounded by the store, which drops the source. */
export function recordAdoption(fromId: string, toId: string): void {
  adoptions.set(toId, fromId);
}

/**
 * Whether `toId` is the id a spawn answered with for `fromId` — consuming the
 * record so one adoption is claimed once.
 *
 * Only a real spawn may carry the transient slot's UI state across: clicking a
 * different session from a pending chat is the same URL transition, and was
 * measured copying `chat.draft` into the other session.
 */
export function consumeAdoption(fromId: string | null | undefined, toId: string): boolean {
  if (!fromId || adoptions.get(toId) !== fromId) return false;
  adoptions.delete(toId);
  return true;
}

/**
 * Whether `toId` is the id a spawn answered with for `fromId`, WITHOUT claiming
 * the record.
 *
 * The agent hook's question is "is this the SAME conversation under a new id",
 * not "may I carry this UI state across": treating an adoption as a session
 * switch threw away `toolResultsRef`/`lastToolMessageRef` mid-turn, so every
 * later progress frame lost its card. The provider still owns the single claim,
 * so peeking here cannot steal it.
 */
export function isSpawnAdoption(fromId: string | null | undefined, toId: string): boolean {
  return Boolean(fromId) && adoptions.get(toId) === fromId;
}
