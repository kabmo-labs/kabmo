/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The ONE registry of live sessions, whichever harness runs them.
 *
 * omp sessions have lived in a `Map<string, AgentSessionWrapper>` on
 * `globalThis` since before harnesses existed; this module keeps that map as the
 * single source and adds an ACP driver that registers into it. Two maps would
 * mean two answers to "is this session live", and the sidebar, the realtime
 * topic and the queue all ask that question.
 *
 * `globalThis` for the documented reason: `bun --hot` re-evaluates a module
 * while the child processes it describes keep running.
 *
 * The harness id travels WITH the session (a `WeakMap`, so a session that dies
 * cannot leak), because `HarnessSession` has no `harness` accessor on the omp
 * wrapper — adding one there would make an omp-only class answer a question
 * about a driver it does not have.
 */

import type { AgentSessionWrapper } from '@/server/lib/omp/rpc/manager';
import type { HarnessId } from '@/shared/lib/harness/catalog';
import type { HarnessSession } from '@/server/lib/harness/session';

type AnySession = AgentSessionWrapper | HarnessSession;

declare global {
  // eslint-disable-next-line no-var
  var __kabmoHarnessOf: WeakMap<object, HarnessId> | undefined;
}

function harnessMap(): WeakMap<object, HarnessId> {
  globalThis.__kabmoHarnessOf ??= new WeakMap();
  return globalThis.__kabmoHarnessOf;
}

/** Record which harness owns a session object. Called once, at spawn. */
export function claimHarness(session: AnySession, harness: HarnessId): void {
  harnessMap().set(session as object, harness);
}

/**
 * The harness behind a live session. Absent means omp RPC: every session that
 * predates this registry is one, and a default here is what keeps a live omp
 * chat from being reported as `unknown`.
 */
export function harnessOf(session: AnySession): HarnessId {
  return harnessMap().get(session as object) ?? 'omp-rpc';
}

/** Narrow a live session to the transport contract, for callers that only need
 *  the shared surface. */
export function asHarnessSession(session: AnySession): HarnessSession {
  return session as unknown as HarnessSession;
}
