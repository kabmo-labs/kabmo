/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Register an ACP session in the shared registry.
 *
 * The two-key rule is omp's, and it matters here for the same reason: an agent
 * may answer a DIFFERENT id than the one asked for (a `session/load` that forks,
 * a first `session/new` on a placeholder). The client keeps posting to the id it
 * holds — its URL, its topic subscription — so the registry must answer for
 * both, and the alias must be removed when the session dies or a dead wrapper
 * answers for a live id.
 */

import type { HarnessSession } from '@/server/lib/harness/session';

/** Pulled from the omp registry module so there is one map, not two. */
export function registerAcpSession(
  session: HarnessSession,
  requestedId: string,
  onDestroy?: () => void,
): void {
  // Imported lazily: `session-registry` imports the omp manager, which imports
  // this file's neighbours, and a top-level import would close that cycle.
  const registry = liveRegistry();
  registry.set(session.sessionId, session);
  if (requestedId && requestedId !== session.sessionId) registry.set(requestedId, session);
  session.onDestroy(() => {
    if (registry.get(session.sessionId) === session) registry.delete(session.sessionId);
    if (registry.get(requestedId) === session) registry.delete(requestedId);
    // The caller's cleanup rides the SAME hook: `onDestroy` holds one callback,
    // so a second registration would replace this one rather than add to it.
    onDestroy?.();
  });
}

function liveRegistry(): Map<string, HarnessSession> {
  const bag = globalThis as unknown as { __ompSessions?: Map<string, HarnessSession> };
  if (!bag.__ompSessions) bag.__ompSessions = new Map();
  return bag.__ompSessions;
}
