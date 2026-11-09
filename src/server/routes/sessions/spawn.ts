/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * POST /api/sessions/spawn — create a session under a parent.
 *
 * Static path, registered before the `:sessionId` routes for the same reason
 * `/api/sessions/batch-archive` is: a parameter route winning the match would
 * answer 405 and hide the real path.
 *
 * The handler owns validation and status mapping only. Everything that decides
 * where the child runs, what it inherits and whether the tree allows it lives in
 * `spawn.server.ts`, because the agent CLI calls the same service.
 */

import { json } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed, parseJsonBody } from '@/server/lib/route-adapter';
import { emitRealtimeSignal } from '@/server/lib/realtime/signals.server';
import {
  SessionSpawnError,
  spawnChildSession,
  type SpawnChildSessionInput,
} from '@/server/lib/sessions/spawn.server';
import { bearerToken, verifyAgentToken } from '@/server/lib/sessions/agent-token.server';

type Visibility = 'visible' | 'hidden';
type ParentNotifications = 'auto' | 'stuck' | 'off';

interface SpawnBody {
  parentSessionId?: unknown;
  /** The CLI's `--parent-self`: resolve the parent from the bearer token. */
  parentSelf?: unknown;
  harness?: unknown;
  cwd?: unknown;
  prompt?: unknown;
  model?: unknown;
  thinkingLevel?: unknown;
  lifecycleOwnerSessionId?: unknown;
  visibility?: unknown;
  parentNotifications?: unknown;
}

function readModel(value: unknown): SpawnChildSessionInput['model'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return typeof record.provider === 'string' && typeof record.modelId === 'string'
    ? { provider: record.provider, modelId: record.modelId }
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function statusFor(code: SessionSpawnError['code']): number {
  switch (code) {
    case 'parent_not_found':
      return 404;
    case 'parent_archived':
    case 'parent_folder_mismatch':
      return 409;
    default:
      return 400;
  }
}

export async function spawnSession({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return methodNotAllowed({ request, params: {} });
  }
  const parsed = await parseJsonBody<SpawnBody>(request);
  if (!parsed.ok) return json({ error: 'Invalid JSON body' }, { status: 400 });

  const prompt = readString(parsed.body.prompt);
  if (!prompt) return json({ error: 'prompt is required' }, { status: 400 });

  // An agent may only spawn under itself. The token is the identity (there is
  // no cookie in a subprocess); `--parent-self` is how the CLI asks for it.
  const tokenSession = verifyAgentToken(bearerToken(request));
  let parentSessionId = readString(parsed.body.parentSessionId);
  if (parsed.body.parentSelf === true) {
    if (!tokenSession) {
      return json({ error: 'parentSelf requires an agent token', code: 'agent_token_required' }, { status: 401 });
    }
    parentSessionId = tokenSession;
  }
  if (tokenSession && parentSessionId !== tokenSession) {
    return json(
      { error: 'An agent may only spawn under its own session', code: 'agent_scope' },
      { status: 403 },
    );
  }

  const visibility = parsed.body.visibility;
  if (visibility !== undefined && visibility !== 'visible' && visibility !== 'hidden') {
    return json({ error: 'visibility must be "visible" or "hidden"' }, { status: 400 });
  }
  const notifications = parsed.body.parentNotifications;
  if (
    notifications !== undefined &&
    notifications !== 'auto' &&
    notifications !== 'stuck' &&
    notifications !== 'off'
  ) {
    return json({ error: 'parentNotifications must be auto, stuck or off' }, { status: 400 });
  }

  try {
    const result = await spawnChildSession({
      parentSessionId,
      harness: readString(parsed.body.harness),
      cwd: readString(parsed.body.cwd),
      prompt,
      model: readModel(parsed.body.model),
      thinkingLevel: readString(parsed.body.thinkingLevel),
      lifecycleOwnerSessionId: readString(parsed.body.lifecycleOwnerSessionId),
      ...(visibility ? { visibility: visibility as Visibility } : {}),
      ...(notifications ? { parentNotifications: notifications as ParentNotifications } : {}),
    });
    emitRealtimeSignal('sidebar-structure');
    return json(result, { status: 201 });
  } catch (error) {
    if (error instanceof SessionSpawnError) {
      return json({ error: error.message, code: error.code }, { status: statusFor(error.code) });
    }
    return json(
      { error: error instanceof Error ? error.message : 'Could not spawn the session' },
      { status: 500 },
    );
  }
}
