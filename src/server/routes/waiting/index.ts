/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `/api/waiting` — prompts held until another session finishes.
 *
 * The list is also served over the `waiting` realtime topic, which is what the
 * sidebar and the composer read; these routes exist for the create/cancel
 * actions and as the read path for a client whose socket is down.
 *
 * Validation is the last gate before the row. In particular the dependency must
 * look UNFINISHED at creation: a dropdown that went stale (the session finished
 * while the user was typing) would otherwise create a prompt that is released on
 * the very next sweep — a prompt the user believed they had deferred. The client
 * re-checks and sends normally instead; this is the server's own refusal for a
 * client that did not.
 */

import { isAbsolute } from 'path';
import { json } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import { emitRealtimeSignal } from '@/server/lib/realtime/signals.server';
import { isDependencySettled } from '@/server/lib/waiting/runtime.server';
import {
  cancelWaitingPrompt,
  createWaitingPrompt,
  getWaitingPrompt,
  listWaitingPrompts,
} from '@/server/lib/waiting/store.server';
import { attachmentHasPayload } from '@/shared/lib/chat/attachments';
import { parseModeSelection } from '@/server/lib/omp/mode/request';
import { isSinglePathSegment } from '@/server/lib/fs/path-segment';
import { isMockMode } from '@/server/mock.server';

/** GET — every prompt a client may still need (waiting + recent outcomes). */
export async function loader(_args: LoaderFunctionArgs) {
  return json({ prompts: await listWaitingPrompts() });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** POST — hold a prompt until `dependsOn` finishes. */
async function createPrompt(request: Request) {
  // A demo install spawns no omp child, so a held prompt could never be sent.
  // Refused with the reason instead of creating a row that waits forever.
  if (isMockMode()) {
    return json(
      { error: 'Held prompts need a real omp session — this console is running on demo data.', code: 'mock_mode' },
      { status: 409 },
    );
  }
  const body = asRecord(await request.json().catch(() => null));
  const dependsOn = typeof body.dependsOn === 'string' ? body.dependsOn.trim() : '';
  if (!dependsOn || !isSinglePathSegment(dependsOn)) {
    return json({ error: 'A session to wait for is required', code: 'depends_on_required' }, { status: 400 });
  }
  const prompt = typeof body.prompt === 'string' ? body.prompt : '';
  const attachments = Array.isArray(body.attachments) ? body.attachments : [];
  // Same rule the composer's own send guard applies: an empty prompt is not a
  // prompt. Without it a row would be created, spawn a session, and deliver
  // nothing to it.
  if (!prompt.trim() && !attachments.some((attachment) => attachmentHasPayload(attachment as never))) {
    return json({ error: 'The prompt is empty', code: 'prompt_required' }, { status: 400 });
  }
  const cwd = typeof body.cwd === 'string' ? body.cwd.trim() : '';
  // `isAbsolute`, not `startsWith('/')`: a Windows workspace names its directory
  // `C:\…`, and the POSIX-only test refused every hold there with
  // `cwd_required` — the prompt was sent immediately instead of being held
  // (measured on the Windows CI leg of `waiting-prompt.e2e.ts`).
  if (!isAbsolute(cwd)) {
    return json({ error: 'An absolute working directory is required', code: 'cwd_required' }, { status: 400 });
  }
  if (await isDependencySettled(dependsOn)) {
    return json(
      { error: 'That session has already finished — send the prompt without waiting.', code: 'dependency_idle' },
      { status: 409 },
    );
  }

  const created = await createWaitingPrompt({
    pendingId: typeof body.pendingId === 'string' ? body.pendingId : null,
    dependsOn,
    dependsOnTitle: typeof body.dependsOnTitle === 'string' ? body.dependsOnTitle : null,
    prompt,
    attachments,
    model: body.model,
    modes: body.modes === undefined ? null : parseModeSelection(asRecord(body.modes)),
    cwd,
    folderId: typeof body.folderId === 'number' ? body.folderId : null,
  });
  emitRealtimeSignal('waiting-changed');
  return json({ prompt: created });
}

/** DELETE `?id=` — cancel a prompt that has not been dispatched yet. */
async function cancelPrompt(request: Request) {
  const id = new URL(request.url).searchParams.get('id') ?? '';
  if (!id) return json({ error: 'id is required', code: 'id_required' }, { status: 400 });
  const existing = await getWaitingPrompt(id);
  if (!existing) return json({ error: 'Waiting prompt not found' }, { status: 404 });
  if (existing.status === 'dispatched') {
    // The prompt has already become a session: Stop that session instead. Saying
    // so is the difference between "cancel did nothing" and a next step.
    return json(
      { error: 'That prompt has already been sent — stop its session instead.', code: 'already_dispatched' },
      { status: 409 },
    );
  }
  const cancelled = await cancelWaitingPrompt(id);
  if (cancelled) emitRealtimeSignal('waiting-changed');
  return json({ cancelled, prompt: await getWaitingPrompt(id) });
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method === 'POST') return createPrompt(request);
  if (request.method === 'DELETE') return cancelPrompt(request);
  return methodNotAllowed({ request, params: {} });
}
