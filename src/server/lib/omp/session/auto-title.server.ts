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
 * `{agentInvoked:false}` immediately, the generation lands ~3-4s later as
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
 * ONE ATTEMPT PER CONVERSATION, RETRIED ONCE INSIDE THE FIRST RUN. The title
 * is derived from the FIRST run and never re-asked after it. omp's `/rename`
 * derives its title from the newest turns (and `generateRenameTitle` reserves a
 * fresh title revision, which cancels any generation still in flight), so a
 * second attempt after turn two would name the session after whatever the
 * conversation had become by then — and could even discard a slow first
 * generation.
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
import { GET_STATE_TIMEOUT_MS, PROMPT_ACK_TIMEOUT_MS, type RpcSessionState } from '@/server/lib/omp/rpc/constants';

/** Settings blob key; mirrors the other blob keys (see `shared/lib/settings/keys`). */
const SETTINGS_BLOB_KEY = 'kabmo_settings';

/** Auto-titling is opt-in per Kabmo install. Default ON: an unnamed session
 *  renders as `New Session - <timestamp>` forever, which is the visible defect,
 *  and the cost is one tiny-model call per session. */
const AUTO_SESSION_TITLE_DEFAULT = true;

/** omp's builtin that generates a title from the conversation. Sent with no
 *  args so omp derives it through its own `generateRenameTitle`. */
const GENERATE_TITLE_COMMAND = '/rename';

/**
 * How long Kabmo's own `/rename` may keep emitting its diagnostic frames.
 *
 * The command answers on the prompt path with an immediate ack and then streams
 * `session_info_update` + `command_output` once the tiny model returns
 * (measured ~4s). Both carry NO correlation id, so the only way to attribute
 * them to our background request is this window. It is deliberately generous —
 * a slow provider must not leak the message — because the cost of over-holding
 * it is only that a slash command typed in the same few seconds loses its
 * output row.
 */
const AUTO_TITLE_OUTPUT_WINDOW_MS = 60_000;

/** Wrapper state this module reads and writes. The in-flight flag, the
 *  output window and the one-shot latch are owned by the caller because they
 *  are per-session runtime state, not policy. */
export interface AutoTitleHost {
  sessionId: string;
  autoTitleInFlight: boolean;
  /** Epoch ms until which frames belong to our own background rename; 0 when
   *  no request is outstanding. */
  autoTitleWindowUntil: number;
  /** True only while this conversation is still eligible for a title at all.
   *  Seeded from omp's own message count when the child is spawned, so it
   *  survives an idle reclaim (a `--resume` child reports the messages it
   *  restored) and is consumed by the first run's terminal `agent_end` — the
   *  fallback's last chance. */
  autoTitlePending: boolean;
  /** True once the early attempt (the first settled user message) has been
   *  made, so a queued steer message cannot re-ask inside the same run. */
  autoTitleRequested: boolean;
  proc: {
    sendCommand<T = unknown>(command: { type: string; [key: string]: unknown }, timeoutMs?: number): Promise<T>;
  };
}

/**
 * Claim the frames our own `/rename` is about to emit, so the wrapper can keep
 * its diagnostics out of the timeline — and, more importantly, so the
 * `prompt_result {agentInvoked:false}` this background command answers with is
 * not read as "the operator's prompt opened no turn".
 *
 * Called BEFORE the request is sent, never after its ack. omp answers the ack
 * and emits the `prompt_result` in the same tick (measured: 3 ms apart on
 * 18.7.0), while the operator's turn is still streaming — so a window opened
 * after the await is already too late. The `prompt_result` then reached the
 * client, which folds it as "the run settled": the generating indicator blanked
 * and the sidebar's live `stream` row was cleared while the answer kept
 * arriving. `frame-fold` only suppresses the frame when the window is armed, so
 * arming late is exactly the hole this ordering closes.
 *
 * On a send that never reached omp the claim is dropped (see the caller), so a
 * window can never belong to nothing and block the settle-stage fallback.
 */
export function markTitleRequestSent(host: AutoTitleHost): void {
  host.autoTitleWindowUntil = Date.now() + AUTO_TITLE_OUTPUT_WINDOW_MS;
}

/**
 * True when this frame is the tail of our own background rename, consuming the
 * window. One frame per request: omp emits exactly one `command_output` for it,
 * on both the success and the "could not generate" path.
 */
export function consumeAutoTitleOutput(host: AutoTitleHost): boolean {
  if (host.autoTitleWindowUntil === 0 || Date.now() > host.autoTitleWindowUntil) return false;
  host.autoTitleWindowUntil = 0;
  return true;
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
 * Called twice at most, both inside the conversation's first run: once when the
 * first user message settles (`opening`), and once at the terminal `agent_end`
 * as a fallback (`settle`). A second run never gets either — see the module
 * doc for why a title derived from a later turn is the bug this gate prevents.
 *
 * Every bail-out is deliberate: a named session is never renamed by this path
 * (the name is re-read from omp, so a rename made in another tab is respected),
 * a generation already in flight is never duplicated, and failures are
 * swallowed — an auto-title is a convenience, and a session whose opening
 * message was low-signal ("hi") simply keeps its placeholder.
 */
export async function triggerAutoSessionTitle(host: AutoTitleHost, stage: AutoTitleStage): Promise<void> {
  if (!host.autoTitlePending) return;
  if (stage === 'opening') {
    // One early attempt per run. A queued steer message also settles as a user
    // message inside the same run, and re-asking on it would cancel the first
    // generation for no gain — the context is the same turn either way.
    if (host.autoTitleRequested) return;
    // Consumed before the first await: two user messages settling in the same
    // tick must not both pass the gate.
    host.autoTitleRequested = true;
  } else {
    // Consumed before the first await: the fallback is this conversation's last
    // chance, and two settles must never both pass the gate.
    host.autoTitlePending = false;
    // The early attempt is still generating. Its `command_output` has not
    // arrived, so omp is mid-generation and a second `/rename` now would
    // reserve a new title revision and cancel it — same title context, wasted
    // model call. Leave the early attempt to finish.
    if (host.autoTitleWindowUntil > Date.now()) return;
  }
  if (host.autoTitleInFlight || !host.sessionId) return;
  if (!(await isAutoTitleEnabled())) return;

  host.autoTitleInFlight = true;
  try {
    // Re-read the name from omp rather than trusting a cached value: a rename
    // made in another tab (or by omp's own TUI on the same session file) would
    // otherwise be overwritten by the `"user"` write `/rename` performs. This is
    // also what makes the fallback a no-op when the early attempt already
    // landed — the name is simply there by then.
    const state = await host.proc.sendCommand<RpcSessionState>({ type: 'get_state' }, GET_STATE_TIMEOUT_MS);
    if (state.sessionName?.trim()) return;
    // The session changed under us (a reset, or a `switch_session`): the name
    // we just read belongs to a different conversation.
    if (state.sessionId !== host.sessionId) return;

    // Direct `proc` write, NOT Kabmo's prompt dispatch: this is
    // background work, so it must not mark the session streaming or claim the
    // sidebar's run row. omp's ack is immediate (`agentInvoked:false`); the
    // generation itself streams back later as ordinary frames.
    //
    // The claim is armed BEFORE the send, not after its ack: omp emits the
    // `prompt_result {agentInvoked:false}` that answers this command within
    // milliseconds, and the fold can only suppress it while the window is open
    // (see `markTitleRequestSent`). An armed window is rolled back if the send
    // never reached omp, so it cannot outlive a request that did not happen.
    markTitleRequestSent(host);
    try {
      await host.proc.sendCommand({ type: 'prompt', message: GENERATE_TITLE_COMMAND }, PROMPT_ACK_TIMEOUT_MS);
    } catch (error) {
      host.autoTitleWindowUntil = 0;
      throw error;
    }
  } catch {
    // Provider error, timeout, or a child that went away — leave the session
    // unnamed; the settle attempt (or the next run, for an aborted turn) tries
    // again.
  } finally {
    host.autoTitleInFlight = false;
  }
}
