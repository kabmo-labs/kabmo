/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which rows a session-switch keeps, and which a committed payload may replace.
 *
 * Split out of `session-load.ts` for the file-size ceiling, and it is one
 * subject rather than an arbitrary cut: both functions answer "does this arrival
 * belong to the session the timeline is already showing?".
 *
 * The distinction they encode was paid for twice, in opposite directions.
 *
 * - **A spawn's arrival is not a session switch.** The optimistic bubbles are
 *   the operator's own turn and the row the stream is filling; clearing them
 *   deleted a turn that had already rendered. Two shapes reach here and only one
 *   was ever recognised: `new-…` → UUID, and a chat opened from a WORKSPACE
 *   (`?folderId=` and no `?sessionId=`), whose previous id is `null` and whose
 *   URL moves straight to the child's UUID. The second was keyed on the
 *   generating flag, so a FAST child — the scripted one answers in milliseconds
 *   — finished before the URL flipped and the reset ran anyway. Measured in CI
 *   on three specs at once: the answer was on screen, then the timeline was
 *   empty. The id the send path recorded is the fact that survives either
 *   ordering.
 * - **A committed payload is a lagging snapshot** while a run this page started
 *   owns the rows, and an own spawn's transcript may legitimately be empty (omp
 *   buffers its writes until the first assistant message settles). Either way it
 *   must not empty the timeline.
 */

/** The ids a session-switch decision needs, all of them refs. */
export interface SessionSwitchFacts {
  sessionId: string | null;
  previousSessionId: string | null;
  /** The id a spawn answered with, recorded by the send path. */
  adoptedSessionId: string | null;
}

/**
 * Whether this change is a spawn's arrival rather than the user opening another
 * session — in which case the optimistic rows stay.
 */
export function isSpawnArrival({ sessionId, previousSessionId, adoptedSessionId }: SessionSwitchFacts): boolean {
  if (!sessionId) return false;
  // The recorded id is checked FIRST and covers both orderings: it is written
  // before the URL moves, so a child that answered mid-run and one that answered
  // after the run ended are the same fact here.
  if (adoptedSessionId === sessionId) return true;
  // `new-…` → UUID. Kept as a fallback for a spawn whose record was already
  // consumed (the pending store hands the adoption to the session-state
  // provider once), where the URL's own shape is the only evidence left.
  return previousSessionId?.startsWith('new-') === true && !sessionId.startsWith('new-');
}

/**
 * Whether `sessionId` is one THIS PAGE spawned, so an empty committed payload
 * means "not written yet" rather than "nothing happened".
 */
export function isOwnSpawn(sessionId: string | null, adoptedSessionId: string | null): boolean {
  if (!sessionId) return false;
  return sessionId.startsWith('new-') || adoptedSessionId === sessionId;
}
