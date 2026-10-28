/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Registering a freshly-spawned omp child in the session registry.
 *
 * Split out of `session-registry.ts` (which sits at the repo's per-file ceiling)
 * so the identity rules read as one unit rather than being interleaved with the
 * spawn plumbing.
 *
 * The whole reason this is not two `registry.set` calls is that the id omp
 * REPORTS can differ from the id the caller ASKED for, and the registry has to
 * answer for both.
 */

import type { AgentSessionWrapper } from '@/server/lib/omp/rpc/manager';

/**
 * Register `created` under the id omp reported AND, when that differs, under the
 * id the caller asked for.
 *
 * The two differ whenever omp FORKS a resumed session instead of continuing it.
 * omp 18.10.0 made that routine rather than exotic: a session marked moved away
 * (`omp session moved`, or a `departed` transfer marker) forks on resume, and omp
 * writes the fork to a fresh file under a fresh id — verified on 18.10.0 by
 * resuming a departed file, which answered a new `sessionId` and a new
 * `sessionFile` in another directory.
 *
 * Keying the registry on the requested id alone therefore MISSED on the very next
 * message: the send re-resolved the ORIGINAL file and spawned again, so one
 * conversation produced a chain of forks — a child and a sidebar row each, with
 * nothing on screen to explain the duplication. Measured on the real spawn path:
 * two sends on one departed session produced two children with two different ids
 * where the second must have found the first.
 *
 * The alias makes the registry answer for the id the CLIENT holds — its URL, its
 * topic subscription, its next POST. It is only installed for an id no other
 * wrapper owns (the caller reaches this point only after its own lookup missed),
 * and it is removed with the wrapper, so a dead child can never answer for it.
 */
export function registerSpawnedSession(
  registry: Map<string, AgentSessionWrapper>,
  created: AgentSessionWrapper,
  requestedId: string,
  realSessionId: string,
): void {
  created.onDestroy(() => {
    if (registry.get(created.sessionId) === created) registry.delete(created.sessionId);
    if (registry.get(realSessionId) === created) registry.delete(realSessionId);
    // The alias must go too, or a dead wrapper would answer for the requested id
    // and every later send would treat the session as live.
    if (registry.get(requestedId) === created) registry.delete(requestedId);
  });
  registry.set(realSessionId, created);
  if (requestedId !== realSessionId && !registry.has(requestedId)) registry.set(requestedId, created);
}
