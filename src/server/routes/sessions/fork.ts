/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * POST /api/sessions/:sessionId/fork — branch a session at an anchor.
 *
 * Mounted under the same `:sessionId` position as the folder loader, so the
 * parameter keeps that name; the suffix is what makes the route distinct.
 */

import { json } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed, parseJsonBody } from '@/server/lib/route-adapter';
import { emitRealtimeSignal } from '@/server/lib/realtime/signals.server';
import { readImages, readModel, readString } from '@/server/routes/sessions/body-readers';
import { isApprovalMode } from '@/shared/lib/omp/config/access-mode';
import { isMockMode } from '@/server/mock.server';
import {
  SessionForkError,
  forkSession,
} from '@/server/lib/sessions/fork.server';

interface ForkBody {
  anchorEntryId?: unknown;
  prompt?: unknown;
  images?: unknown;
  model?: unknown;
  thinkingLevel?: unknown;
  accessMode?: unknown;
  title?: unknown;
  cwd?: unknown;
  visibility?: unknown;
  lifecycleOwnerSessionId?: unknown;
}

export async function forkSessionRoute({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'POST') return methodNotAllowed({ request, params });
  const sourceSessionId = params.sessionId;
  if (!sourceSessionId) return json({ error: 'Missing session id' }, { status: 400 });

  const parsed = await parseJsonBody<ForkBody>(request);
  if (!parsed.ok) return json({ error: 'Invalid JSON body' }, { status: 400 });
  // MOCK mode has no transcript to branch. The client answers with the
  // simulated stream on this CODE, as it does for a new chat.
  if (isMockMode()) {
    return json({ error: 'Mock mode runs no agent process', code: 'mock_mode' }, { status: 400 });
  }
  const visibility = parsed.body.visibility;
  if (visibility !== undefined && visibility !== 'visible' && visibility !== 'hidden') {
    return json({ error: 'visibility must be "visible" or "hidden"' }, { status: 400 });
  }
  if (parsed.body.accessMode !== undefined && !isApprovalMode(parsed.body.accessMode)) {
    return json({ error: 'accessMode is not a valid approval mode' }, { status: 400 });
  }

  try {
    const result = await forkSession({
      sourceSessionId,
      anchorEntryId: readString(parsed.body.anchorEntryId),
      prompt: readString(parsed.body.prompt),
      images: readImages(parsed.body.images),
      model: readModel(parsed.body.model),
      thinkingLevel: readString(parsed.body.thinkingLevel),
      accessMode: isApprovalMode(parsed.body.accessMode) ? parsed.body.accessMode : null,
      title: readString(parsed.body.title),
      cwd: readString(parsed.body.cwd),
      ...(visibility ? { visibility: visibility as 'visible' | 'hidden' } : {}),
      lifecycleOwnerSessionId: readString(parsed.body.lifecycleOwnerSessionId),
    });
    emitRealtimeSignal('sidebar-structure');
    return json(result, { status: 201 });
  } catch (error) {
    if (error instanceof SessionForkError) {
      const status =
        error.code === 'source_not_found'
          ? 404
          : error.code === 'source_archived' || error.code === 'fork_requires_checkpoint'
            ? 409
            : 400;
      return json({ error: error.message, code: error.code }, { status });
    }
    return json(
      { error: error instanceof Error ? error.message : 'Could not fork the session' },
      { status: 500 },
    );
  }
}
