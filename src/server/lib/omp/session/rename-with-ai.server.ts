/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * "Rename with AI" — the session row's menu action that asks omp to name a
 * conversation from its own transcript.
 *
 * It is the MANUAL counterpart of Kabmo's auto-titling
 * (`auto-title.server.ts`), and the difference is the whole point: auto-titling
 * refuses to touch a session that already has a name, because it fires
 * unrequested and would overwrite what the operator typed. This action IS the
 * request, so it renames regardless — verified against a real omp child:
 * `/rename` fired at a session explicitly named "MY DELIBERATE NAME" returned
 * "PostgreSQL connection pool in Rust".
 *
 * Everything else is shared with auto-titling, including the two omp facts it
 * is built on (both re-verified here on omp 18.3.x):
 *
 *   - `/rename` with no args is dispatched by rpc-mode BEFORE the prompt frame
 *     becomes a turn, so it is background work: the ack is `{agentInvoked:false}`
 *     and nothing is appended to the transcript. Sending it through the
 *     wrapper's `send()` would instead mark the session streaming and flash the
 *     sidebar's run badge, so it goes straight to the process.
 *   - omp answers with `session_info_update` (the new title) then
 *     `command_output` ("Session renamed to …", or "Could not generate a
 *     session title" when the transcript is too thin). The frames carry no
 *     correlation id, so the wrapper's request WINDOW is what keeps the
 *     diagnostics out of the timeline — the same mechanism auto-titling uses,
 *     and the reason `markTitleRequestSent` is called here too.
 *
 * The route awaits the outcome rather than firing and forgetting: the caller
 * has to be told either the new name or why none was produced, and a title
 * generation takes a few seconds.
 */

import { getRpcSession, resolveSpawnCwd, startRpcSession } from '@/server/lib/omp/rpc/manager';
import { resolveSessionPathOr404 } from '@/server/lib/omp/session/locator';
import type { AutoTitleHost } from '@/server/lib/omp/session/auto-title.server';
import {
  GENERATE_TITLE_COMMAND,
  releaseTitleClaim,
  sendTitleRequest,
} from '@/server/lib/omp/session/title-request.server';
import { resolveSessionOwnership, SessionOwnedElsewhereError } from '@/server/lib/omp/session/ownership.server';
import { clearSessionFileCaches } from '@/server/lib/omp/session/files';
import { loadSessionModel } from '@/server/lib/omp/session/messages';
import { withTitleModelOverride } from '@/server/lib/omp/session/title-model-overlay.server';
import { loadPersistedAccessMode } from '@/shared/lib/omp/config/access-mode.server';
import { isMockMode } from '@/server/mock.server';

/**
 * How long the generation may take before the caller is told it timed out.
 *
 * Measured at ~3-4s against a live child; the ceiling is generous because the
 * title comes from a model call and a slow provider is not a failure. It is
 * well under the 60s output window, so the window can never outlive the wait
 * and swallow a later, unrelated `command_output`.
 */
const GENERATE_TIMEOUT_MS = 45_000;

export type RenameWithAiResult =
  | { ok: true; title: string }
  | { ok: false; error: string; status: number };

/**
 * Ask omp to name this session from its transcript.
 *
 * Refused while the session is busy: omp derives the title from the NEWEST
 * turns, so naming a conversation mid-run would name it after a half-finished
 * turn — and omp runs RPC handlers one at a time, so the request would sit
 * queued behind the very turn it should not have been reading.
 *
 * The generation runs with the `tiny` role pointed at the SESSION's own model
 * (see `title-model-overlay.server.ts`). omp's `/rename` names a session with
 * the `tiny` role and only ever appends the session's model when
 * `retry.modelFallback` is on — so a user whose tiny role points at a provider
 * whose plan lapsed got "Could not generate a session title" after a 53s
 * timeout, while the conversation's own model answered the same request in ~7s.
 * The override is scoped to this call and removed in its `finally`.
 */
export async function renameSessionWithAi(sessionId: string): Promise<RenameWithAiResult> {
  if (isMockMode()) {
    return { ok: false, error: 'Renaming with AI needs a real omp session.', status: 400 };
  }

  const resolved = await resolveSessionPathOr404(sessionId);
  if ('response' in resolved) {
    return { ok: false, error: 'Session not found', status: 404 };
  }

  let session = getRpcSession(sessionId);
  if (!session?.isAlive()) {
    const cwd = await resolveSpawnCwd(resolved.recordedCwd);
    const spawnMode = await loadPersistedAccessMode();
    // A session Kabmo is not managing still has a transcript on disk, so
    // the child is resumed for this one action — the same spawn the send path
    // performs, minus the prompt bookkeeping. Refused when another process owns
    // the file: resuming it would make omp fork the session (open-elsewhere).
    const ownership = await resolveSessionOwnership(sessionId);
    if (ownership) {
      return { ok: false, error: new SessionOwnedElsewhereError(sessionId, ownership).message, status: 409 };
    }
    const started = await startRpcSession(sessionId, resolved.filePath, cwd, resolved.recordedCwd, spawnMode);
    session = started.session;
  }

  if (session.isBusy()) {
    return {
      ok: false,
      error: 'This session is working. Stop the run before renaming it.',
      status: 409,
    };
  }

  // Read from the session FILE, not from the live child: the overlay has to be
  // written before `/rename` is dispatched, and the file is what the model
  // actually ran on (a child resumed for this one action has the model its
  // transcript records). A model that cannot be read leaves the role alone —
  // naming the session with a model the conversation never used would be worse
  // than the role the user configured.
  const model = await loadSessionModel(resolved.filePath);
  const selector = model ? `${model.provider}/${model.modelId}` : undefined;

  const outcome = await withTitleModelOverride(selector, () => awaitTitleFrame(session));
  if (outcome.ok) clearSessionFileCaches();
  return outcome;
}

/**
 * The surface this action needs from the session wrapper: the shared
 * `AutoTitleHost` state (so `markTitleRequestSent` can claim the output window)
 * plus the frame subscription the prompt-ack interface does not carry.
 */
export type TitleFrameHost = AutoTitleHost & {
  proc: AutoTitleHost['proc'] & {
    onFrame(listener: (frame: { type: string; [key: string]: unknown }) => void): () => void;
  };
};

/**
 * Send `/rename` and resolve on the first frame that answers it.
 *
 * Success and failure are distinguished by WHICH frame arrives, not by its
 * content: a generated title lands as `session_info_update`, while a refusal
 * ("Could not generate a session title", a provider error) lands only as
 * `command_output`. Verified on a real child — a successful rename emits
 * `session_info_update` first, so resolving on either frame yields the right
 * verdict without parsing omp's prose.
 */
export function awaitTitleFrame(host: TitleFrameHost): Promise<RenameWithAiResult> {
  const { promise, resolve } = Promise.withResolvers<RenameWithAiResult>();
  let settled = false;
  const finish = (result: RenameWithAiResult) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    off();
    resolve(result);
  };

  const off = host.proc.onFrame((frame) => {
    if (frame.type === 'session_info_update') {
      const title = typeof frame.title === 'string' ? frame.title.trim() : '';
      if (title) finish({ ok: true, title });
      return;
    }
    if (frame.type === 'command_output') {
      const text = typeof frame.text === 'string' ? frame.text.trim() : '';
      finish({ ok: false, error: text || 'omp did not produce a session title.', status: 502 });
    }
  });

  const timer = setTimeout(() => {
    // A request that never answered can never be answered: drop its claim, or
    // it would swallow the operator's next `command_output` as "our rename".
    releaseTitleClaim(host);
    finish({ ok: false, error: 'Timed out waiting for a generated title.', status: 504 });
  }, GENERATE_TIMEOUT_MS);
  // A pending generation must never hold the event loop open on its own.
  timer.unref?.();

  // The claim is armed by the shared dispatcher BEFORE the send (and released
  // by it if the send never reached omp), so the `command_output` this request
  // answers with stays out of the timeline. The claim is deliberately NOT
  // released on the success frame: omp emits `session_info_update` first and
  // the `command_output` a few milliseconds later, and releasing on the title
  // would let that second frame render as a notice row.
  //
  // The dispatch slot is claimed SYNCHRONOUSLY, before the first await, so a
  // prompt the operator sends while this rename is still generating waits for
  // it instead of racing it (`awaitTitleDispatch` in the prompt path).
  const previous = host.autoTitleDispatch ?? null;
  const request = sendTitleRequest(host, GENERATE_TITLE_COMMAND, previous);
  const dispatched = request.then(
    () => undefined,
    () => undefined,
  );
  host.autoTitleDispatch = dispatched;
  void dispatched.then(() => {
    if (host.autoTitleDispatch === dispatched) host.autoTitleDispatch = null;
  });
  void request.catch((error: unknown) => {
    finish({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      status: 502,
    });
  });

  return promise;
}
