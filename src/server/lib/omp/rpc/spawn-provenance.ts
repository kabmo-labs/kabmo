/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What a wrapper's omp child was SPAWNED with.
 *
 * Two spawn-time facts have to outlive the `RpcProcess` that carried them, and
 * they behave differently once the child is up:
 *
 *  - the **approval mode** (`--approval-mode`) has no RPC setter, so a live
 *    wrapper is stale the moment the desired mode differs and must be respawned;
 *  - the **mode selection** (`KABMO_MODES`) is read once, at session start, by
 *    Kabmo's extension — but a mismatch needs NO respawn, because a mode
 *    command re-applies both flags in-process. It is kept so a COLD start gets
 *    the right environment, and so the prewarm pool can tell an entry that can
 *    serve a request from one that cannot.
 *
 * Both live on `globalThis`, like the registry itself: a `bun --hot` soft reload
 * re-evaluates modules but keeps `globalThis`, and a forgotten mode would make
 * the reconcile destroy and respawn an idle session with the wrong flag on its
 * first post-reload command.
 */

import type { AgentSessionWrapper } from '@/server/lib/omp/rpc/manager';
import { DEFAULT_APPROVAL_MODE, type ApprovalMode } from '@/shared/lib/omp/config/access-mode';

declare global {
  // eslint-disable-next-line no-var
  var __ompSpawnApprovalModes: WeakMap<AgentSessionWrapper, ApprovalMode> | undefined;
  // eslint-disable-next-line no-var
  var __ompSpawnModeEnvs: WeakMap<AgentSessionWrapper, Record<string, string>> | undefined;
}

function approvalModes(): WeakMap<AgentSessionWrapper, ApprovalMode> {
  if (!globalThis.__ompSpawnApprovalModes) globalThis.__ompSpawnApprovalModes = new WeakMap();
  return globalThis.__ompSpawnApprovalModes;
}

function modeEnvs(): WeakMap<AgentSessionWrapper, Record<string, string>> {
  if (!globalThis.__ompSpawnModeEnvs) globalThis.__ompSpawnModeEnvs = new WeakMap();
  return globalThis.__ompSpawnModeEnvs;
}

export function recordSpawnProvenance(
  session: AgentSessionWrapper,
  approvalMode: ApprovalMode | undefined,
  modeEnv: Record<string, string> | undefined,
): void {
  approvalModes().set(session, approvalMode ?? DEFAULT_APPROVAL_MODE);
  modeEnvs().set(session, modeEnv ?? {});
}

export function getSpawnApprovalMode(session: AgentSessionWrapper): ApprovalMode {
  return approvalModes().get(session) ?? DEFAULT_APPROVAL_MODE;
}

export function getSpawnModeEnv(session: AgentSessionWrapper): Record<string, string> {
  return modeEnvs().get(session) ?? {};
}

/**
 * Destroy an idle session whose spawned approval mode differs from `desired`
 * so the caller can respawn it with the new `--approval-mode` flag.
 * Returns true when the session was destroyed (caller MUST respawn).
 */
export async function reconcileSpawnApprovalMode(
  session: AgentSessionWrapper,
  desired: ApprovalMode,
): Promise<boolean> {
  if (getSpawnApprovalMode(session) === desired) return false;
  // Never kill in-flight work — the caller would lose the active turn, and a
  // live subagent outlives that turn.
  if (session.isBusy()) return false;
  // A brand-new session has no JSONL on disk yet; destroying it would 404 the
  // next request that tries to resolve its file.
  if (!session.sessionFile) return false;
  if (!(await Bun.file(session.sessionFile).exists())) return false;
  await session.destroyAndWait();
  return true;
}
