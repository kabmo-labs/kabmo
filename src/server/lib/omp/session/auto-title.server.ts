/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Auto session titles for Kabmo.
 *
 * Kabmo spawns omp with `--mode rpc-ui`, and that mode force-sets
 * `PI_NO_TITLE=1` (omp's main.ts). The flag gates only the two AUTOMATIC title
 * paths — `AgentSession.maybeStartTitleGeneration` (first user message) and
 * `#scheduleReplanTitleRefresh` (todo replan) — so a Kabmo session is never
 * named on its own and the sidebar keeps the `New Session - <timestamp>`
 * placeholder for its whole life.
 *
 * The generate path itself is NOT gated: `/rename` with no args reaches
 * `session.generateTitle()` through `executeAcpBuiltinSlashCommand`, which
 * rpc-mode dispatches for a `prompt` frame BEFORE that frame is forwarded as a
 * turn — so the request can be sent at any point in a run and never becomes
 * part of the conversation. Verified against omp 18.3.0 — the ack returns
 * `{agentInvoked:false}` immediately, the generation lands seconds later as
 * `session_info_update` + `command_output`, and no entry is written to the
 * transcript.
 *
 * WHY THE NAME MUST BE EMPTY FIRST: `/rename` persists through
 * `setSessionName(title, "user")`. omp's own guard only refuses an `"auto"`
 * write over a `"user"` title, so a `/rename` fired against an already-named
 * session would overwrite the operator's own name. The unnamed check below is
 * therefore a safety property, not a nicety — it is re-read from `get_state`
 * on every attempt rather than cached, so a rename made in another tab is
 * respected.
 *
 * ## The title runs on the SESSION's model, not omp's `tiny` role
 *
 * This is the reason auto-titling produced no name at all on a real install:
 * omp names a session with its `tiny` ROLE (`getTitleModels` →
 * `roleCandidatePool("tiny")`) and only appends the session's own model when
 * `retry.modelFallback` is on. Measured on this machine — six auto-title
 * attempts across four fresh sessions, every one on
 * `kenari/deepseek-v4-flash`, every one answered `429 plan_limit_reached`
 * after ~52 s, and not a single session named; the two renames that DID succeed
 * (the manual action) ran on `kenari-jatis/deepseek-v4-1-flash`, the
 * conversation's own model, through the pin. `withTitleModelOverride` now wraps
 * BOTH paths, and it is held until the request's frames arrive — omp resolves
 * the role again for the card request that follows a successful title, so a pin
 * released on the ack would produce an uncarded title (or none).
 *
 * ## One attempt per conversation, retried ONCE after the first run
 *
 * The title is derived from the FIRST run and never re-asked after it. omp's
 * `/rename` derives its title from the newest turns (and `renameTitle` reserves
 * a fresh title revision, which cancels any generation still in flight), so a
 * third attempt after turn two would name the session after whatever the
 * conversation had become by then.
 *
 * There are exactly two triggers, both inside that first run:
 *
 *   1. the first settled USER message — the earliest point at which the
 *      transcript carries the conversation's opening intent. (`agent_start` is
 *      too early to be usable: omp pushes it before the turn opens, so the
 *      transcript is still empty there and the title context comes back blank.
 *      See the `message_end` branch of frame-fold.)
 *   2. the terminal `agent_end`, as a fallback when the early attempt produced
 *      no title — a provider error, a timeout, a child that went away, or the
 *      tiny model declining.
 *
 * **The fallback ALWAYS dispatches.** It used to stand down while the early
 * generation was "still in flight" (the claim window), which assumed that
 * generation would land; on a real session it was the attempt that had already
 * failed 52 s earlier, and the run ended with the window still armed — so the
 * session was never asked again. The two dispatches are serialized
 * (`title-request.server.ts`), and the last one wins omp's title revision,
 * which is the behaviour we want: the fallback reads the completed first turn.
 *
 * The eligibility latch `autoTitlePending` is consumed by the fallback, so that
 * is the last chance this conversation gets and a later run can never title it.
 * `autoTitleRequested` is what keeps the early trigger from firing again on a
 * queued steer message. A session that a skill invocation opened has no
 * user-role message at all (omp delivers it as a `custom` message), so the
 * early trigger never fires there and the fallback is what names it.
 *
 * A first message that omp's low-signal filter rejects ("hi") therefore leaves
 * the session unnamed for good, which is the honest outcome: the fallback does
 * re-ask, and omp declines a second time (measured on omp 18.3.0 — the
 * rejection is a property of the opening message, not of when it is asked).
 */

import { readSettingsJson } from '@/server/lib/db/settings-store';
import { getDb } from '@/server/db.server';
import { GET_STATE_TIMEOUT_MS, type RpcSessionState } from '@/server/lib/omp/rpc/constants';
import {
  GENERATE_TITLE_COMMAND,
  sendTitleRequest,
  waitForTitleOutcome,
  type TitleRequestHost,
} from '@/server/lib/omp/session/title-request.server';
import { withTitleModelOverride } from '@/server/lib/omp/session/title-model-overlay.server';

export {
  GENERATE_TITLE_COMMAND,
  awaitTitleDispatch,
  consumeAutoTitleOutput,
  markTitleRequestSent,
  releaseTitleClaim,
  sendTitleRequest,
  waitForTitleOutcome,
} from '@/server/lib/omp/session/title-request.server';
export type { TitleRequestHost } from '@/server/lib/omp/session/title-request.server';

/** Settings blob key; mirrors the other blob keys (see `shared/lib/settings/keys`). */
const SETTINGS_BLOB_KEY = 'kabmo_settings';

/** Auto-titling is opt-in per Kabmo install. Default ON: an unnamed session
 *  renders as `New Session - <timestamp>` forever, which is the visible defect,
 *  and the cost is one tiny-model call per session. */
const AUTO_SESSION_TITLE_DEFAULT = true;

/** Wrapper state this module reads and writes. The dispatch chain and the claim
 *  count are owned by the caller because they are per-session runtime state,
 *  not policy. */
export interface AutoTitleHost extends TitleRequestHost {
  /** True only while this conversation is still eligible for a title at all.
   *  Seeded from omp's own message count when the child is spawned, so it
   *  survives an idle reclaim (a `--resume` child reports the messages it
   *  restored) and is consumed by the first run's terminal `agent_end` — the
   *  fallback's last chance. */
  autoTitlePending: boolean;
  /** True once the early attempt (the first settled user message) has been
   *  made, so a queued steer message cannot re-ask inside the same run. */
  autoTitleRequested: boolean;
  /** The model the session is actually served by — the pin the title request
   *  runs under. Null before the child reports one; the request then runs on
   *  omp's configured role, which is the only honest fallback. */
  autoTitleModel?: { provider: string; modelId: string } | null;
}

/**
 * Read the `autoSessionTitle` flag from Kabmo settings blob. Absent or
 * malformed → the default. Never throws: a settings read must not be able to
 * break a turn's settle path.
 */
async function isAutoTitleEnabled(): Promise<boolean> {
  try {
    const db = await getDb();
    const blob = await readSettingsJson<Record<string, unknown> | null>(db, SETTINGS_BLOB_KEY, null);
    const value = blob?.autoSessionTitle;
    return typeof value === 'boolean' ? value : AUTO_SESSION_TITLE_DEFAULT;
  } catch {
    return AUTO_SESSION_TITLE_DEFAULT;
  }
}

/**
 * Which of the two attempts inside the first run is asking.
 *
 * - `opening` — the first settled USER message. Earliest usable point, and it
 *   does NOT consume the eligibility latch, so `settle` can still retry.
 * - `settle` — the terminal `agent_end`. The fallback, and the attempt that
 *   consumes the latch: after it, this conversation is never titled again.
 */
export type AutoTitleStage = 'opening' | 'settle';

/**
 * Ask omp to name this session from its opening turns.
 *
 * The eligibility gates run SYNCHRONOUSLY, and the request is chained onto the
 * host's dispatch slot before the first await. That ordering is what lets a
 * prompt sent right after the run end wait for this rename to reach the child
 * (`awaitTitleDispatch` in the prompt path) instead of racing it.
 */
export function triggerAutoSessionTitle(host: AutoTitleHost, stage: AutoTitleStage): Promise<void> {
  if (!host.autoTitlePending) return Promise.resolve();
  if (stage === 'opening') {
    // One early attempt per run. A queued steer message also settles as a user
    // message inside the same run, and re-asking on it would cancel the first
    // generation for no gain — the context is the same turn either way.
    if (host.autoTitleRequested) return Promise.resolve();
    // Consumed synchronously: two user messages settling in the same tick must
    // not both pass the gate.
    host.autoTitleRequested = true;
  } else {
    // Consumed before the first await: the fallback is this conversation's last
    // chance, and two settles must never both pass the gate.
    host.autoTitlePending = false;
  }
  if (!host.sessionId) return Promise.resolve();

  // Captured before this run claims the slot: the run's own dispatch queues
  // behind what was already in flight, not behind itself.
  const previous = host.autoTitleDispatch;
  // Two different promises, deliberately:
  //   - the DISPATCH resolves when the request is on the wire (or the gate
  //     decided not to send). That is what a following prompt waits for, and
  //     what the next request is chained behind;
  //   - the returned REQUEST resolves when the model pin has been released,
  //     which is after the generation answered — a title model can take a
  //     minute, and no prompt should wait for that.
  const dispatched = Promise.withResolvers<void>();
  const run = runTitleRequest(host, previous, dispatched.resolve);
  const barrier = dispatched.promise;
  host.autoTitleDispatch = barrier;
  void barrier.then(() => {
    if (host.autoTitleDispatch === barrier) host.autoTitleDispatch = null;
  });
  return run.then(
    () => undefined,
    () => undefined,
  );
}

/** The gated part: settings, the unnamed check, the model pin, the send. */
async function runTitleRequest(
  host: AutoTitleHost,
  after: Promise<void> | null,
  onDispatched: () => void,
): Promise<void> {
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    onDispatched();
  };
  try {
    await dispatchTitleRequest(host, after, release);
  } finally {
    // Every exit — a disabled setting, a named session, a failed send — must
    // release the barrier: a prompt waiting on it pays the ceiling otherwise.
    release();
  }
}

async function dispatchTitleRequest(
  host: AutoTitleHost,
  after: Promise<void> | null,
  onDispatched: () => void,
): Promise<void> {
  if (!(await isAutoTitleEnabled())) return;

  let state: RpcSessionState;
  try {
    // Re-read the name from omp rather than trusting a cached value: a rename
    // made in another tab (or by omp's own TUI on the same session file) would
    // otherwise be overwritten by the `"user"` write `/rename` performs. This is
    // also what makes the fallback a no-op when the early attempt already
    // landed — the name is simply there by then.
    state = await host.proc.sendCommand<RpcSessionState>({ type: 'get_state' }, GET_STATE_TIMEOUT_MS);
  } catch {
    // Provider error, timeout, or a child that went away — leave the session
    // unnamed rather than naming the wrong conversation.
    return;
  }
  if (state.sessionName?.trim()) return;
  // The session changed under us (a reset, or a `switch_session`): the name we
  // just read belongs to a different conversation.
  if (state.sessionId !== host.sessionId) return;

  const model = host.autoTitleModel;
  const selector = model ? `${model.provider}/${model.modelId}` : undefined;
  await withTitleModelOverride(selector, async () => {
    try {
      // Direct `proc` write, NOT Kabmo's prompt dispatch: this is background
      // work, so it must not mark the session streaming or claim the sidebar's
      // run row. omp's ack is immediate (`agentInvoked:false`); the generation
      // itself streams back later as ordinary frames.
      await sendTitleRequest(host, GENERATE_TITLE_COMMAND, after);
    } finally {
      // The request is on the wire (or refused): a prompt waiting on this
      // rename must be released now, not after the generation.
      onDispatched();
    }
    // The pin is held across the generation, not just the dispatch: omp
    // resolves the title role again for the card request that follows a
    // successful title, and releasing it there names the session with the
    // configured role — the failure the pin exists to avoid.
    await waitForTitleOutcome(host);
  }).catch(() => {
    // A refused send or a cancelled generation leaves the session unnamed; the
    // other stage (or nothing) is the honest outcome.
  });
}
