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
import {
  SessionForkError,
  forkSession,
} from '@/server/lib/sessions/fork.server';

interface ForkBody {
  anchorEntryId?: unknown;
  prompt?: unknown;
  title?: unknown;
  cwd?: unknown;
  visibility?: unknown;
  lifecycleOwnerSessionId?: unknown;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export async function forkSessionRoute({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'POST') return methodNotAllowed({ request, params });
  const sourceSessionId = params.sessionId;
  if (!sourceSessionId) return json({ error: 'Missing session id' }, { status: 400 });

  const parsed = await parseJsonBody<ForkBody>(request);
  if (!parsed.ok) return json({ error: 'Invalid JSON body' }, { status: 400 });
  const visibility = parsed.body.visibility;
  if (visibility !== undefined && visibility !== 'visible' && visibility !== 'hidden') {
    return json({ error: 'visibility must be "visible" or "hidden"' }, { status: 400 });
  }

  try {
    const result = await forkSession({
      sourceSessionId,
      anchorEntryId: readString(parsed.body.anchorEntryId),
      prompt: readString(parsed.body.prompt),
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
