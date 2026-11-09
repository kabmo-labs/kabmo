/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Spawn a child session — the delegation half of the tree.
 *
 * The child is a normal session: same spawn paths, same transport, same
 * permissions. What makes it a child is one relation row plus the notification
 * edge; nothing about the agent process knows it was delegated. That is
 * deliberate: a child that outlives its parent is an ordinary session, and a
 * parent that dies must not take the child's transcript with it.
 *
 * Validation happens BEFORE the spawn, and the relation is written before the
 * first prompt: a fast provider can finish a turn in under a second, and a
 * completion with no relation row would be a notification nobody receives.
 */

import { loadPersistedAccessMode } from '@/shared/lib/omp/config/access-mode.server';
import {
  agentEnvironment,
  createAgentToken,
  rememberAgentToken,
} from '@/server/lib/sessions/agent-token.server';
import type { ApprovalMode } from '@/shared/lib/omp/config/access-mode';
import { projectModelForCwd } from '@/server/lib/workspace/project-model.server';
import { startAcpSession } from '@/server/lib/harness/spawn.server';
import { startNewRpcSession } from '@/server/lib/omp/rpc/session-registry';
import { getDb } from '@/server/db.server';
import { HARNESS_IDS, harnessDescriptor, type HarnessId } from '@/shared/lib/harness/catalog';
import type { SelectedModel } from '@/shared/types/models';
import { MAX_SESSION_DEPTH } from '@/server/lib/sessions/relation-types';
import {
  createSessionRelation,
  getSessionRelation,
} from '@/server/lib/sessions/relations.server';
import {
  folderIdForCwd,
  isSessionArchived,
  resolveSessionRef,
  sessionExists,
} from '@/server/lib/sessions/resolve.server';

export type SessionSpawnErrorCode =
  | 'cwd_required'
  | 'harness_unknown'
  | 'parent_not_found'
  | 'parent_archived'
  | 'parent_folder_mismatch'
  | 'spawn_failed';

export class SessionSpawnError extends Error {
  constructor(
    readonly code: SessionSpawnErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SessionSpawnError';
  }
}

/** The slice of a spawned session this service uses. */
export interface SpawnedSession {
  readonly sessionId: string;
  send(command: Record<string, unknown>): Promise<unknown>;
  destroyAndWait(): Promise<void>;
}

export interface SpawnSessionDeps {
  startRpc(
    cwd: string,
    accessMode: ApprovalMode,
    env: Record<string, string>,
  ): Promise<{ session: SpawnedSession; realSessionId: string }>;
  startAcp(request: {
    harness: HarnessId;
    sessionId: string;
    cwd: string;
    model: SelectedModel | null;
    thinkingLevel: string | null;
    accessMode: ApprovalMode;
    env: Record<string, string>;
  }): Promise<{ session: SpawnedSession; realSessionId: string }>;
}

const defaultDeps: SpawnSessionDeps = {
  startRpc: (cwd, accessMode, env) => startNewRpcSession(cwd, accessMode, env),
  startAcp: (request) => startAcpSession(request),
};

export interface SpawnChildSessionInput {
  /** Omit for a root session created through this path. */
  parentSessionId?: string | null;
  harness?: string | null;
  cwd?: string | null;
  prompt: string;
  model?: SelectedModel | null;
  thinkingLevel?: string | null;
  lifecycleOwnerSessionId?: string | null;
  visibility?: 'visible' | 'hidden';
  parentNotifications?: 'auto' | 'stuck' | 'off';
}

export interface SpawnChildSessionResult {
  sessionId: string;
  harness: HarnessId;
  parentSessionId: string | null;
  depth: number;
}

function harnessOf(value: string | null | undefined): HarnessId | null {
  if (!value) return null;
  return HARNESS_IDS.includes(value as HarnessId) ? (value as HarnessId) : null;
}

/**
 * Resolve the parent's execution context and the child's cwd.
 *
 * The folder check is refused only when BOTH folders resolve: a session whose
 * cwd sits outside every registered workspace has no folder to compare, and
 * refusing on that would block work the sidebar would happily show.
 */
async function resolveParent(
  parentSessionId: string,
  requestedCwd: string | null,
): Promise<{ cwd: string; harness: HarnessId | null }> {
  if (!(await sessionExists(parentSessionId))) {
    throw new SessionSpawnError('parent_not_found', `Parent session ${parentSessionId} not found`);
  }
  if (await isSessionArchived(parentSessionId)) {
    throw new SessionSpawnError('parent_archived', 'Cannot spawn under an archived session');
  }
  const parent = await resolveSessionRef(parentSessionId);
  const cwd = requestedCwd || parent.cwd;
  if (!cwd) {
    throw new SessionSpawnError(
      'cwd_required',
      'The parent has no working directory; pass one explicitly',
    );
  }
  if (requestedCwd && parent.cwd) {
    const [parentFolder, childFolder] = await Promise.all([
      folderIdForCwd(parent.cwd),
      folderIdForCwd(requestedCwd),
    ]);
    if (parentFolder !== null && childFolder !== null && parentFolder !== childFolder) {
      throw new SessionSpawnError(
        'parent_folder_mismatch',
        'A child session must stay in its parent workspace folder',
      );
    }
  }
  return { cwd, harness: parent.harness };
}

/** Spawn a session, record its relation, then dispatch the first prompt. */
export async function spawnChildSession(
  input: SpawnChildSessionInput,
  deps: SpawnSessionDeps = defaultDeps,
): Promise<SpawnChildSessionResult> {
  const prompt = input.prompt.trim();
  if (!prompt) {
    throw new SessionSpawnError('spawn_failed', 'A first prompt is required');
  }
  const parentSessionId = input.parentSessionId ?? null;
  const requestedHarness = input.harness ?? null;
  const parent = parentSessionId
    ? await resolveParent(parentSessionId, input.cwd ?? null)
    : null;
  const cwd = parent?.cwd ?? input.cwd ?? null;
  if (!cwd) {
    throw new SessionSpawnError('cwd_required', 'A working directory is required');
  }

  const requested = harnessOf(requestedHarness);
  if (requestedHarness && requested === null) {
    throw new SessionSpawnError('harness_unknown', `Unknown harness: ${requestedHarness}`);
  }
  const harness = requested ?? parent?.harness ?? 'omp-rpc';
  const parentRelation = parentSessionId ? await getSessionRelation(parentSessionId) : null;
  const depth = (parentRelation?.depth ?? 0) + 1;
  if (depth > MAX_SESSION_DEPTH) {
    throw new SessionSpawnError(
      'spawn_failed',
      `A session tree is limited to ${MAX_SESSION_DEPTH} levels`,
    );
  }

  const accessMode = await loadPersistedAccessMode();
  const token = createAgentToken();
  const env = agentEnvironment(token);
  const model =
    input.model ??
    (await projectModelForCwd(await getDb(), cwd).catch(() => null));
  const started =
    harness === 'omp-rpc'
      ? await deps.startRpc(cwd, accessMode, env)
      : await deps.startAcp({
          harness,
          sessionId: `__new__${Bun.randomUUIDv7()}`,
          cwd,
          model,
          thinkingLevel: input.thinkingLevel ?? null,
          accessMode,
          env,
        });

  try {
    await rememberAgentToken(started.realSessionId, token);
    await createSessionRelation({
      sessionId: started.realSessionId,
      parentSessionId,
      lifecycleOwnerSessionId: input.lifecycleOwnerSessionId ?? parentSessionId,
      visibility: input.visibility ?? 'visible',
      parentNotifications: input.parentNotifications ?? 'auto',
    });
  } catch (error) {
    // The child exists but cannot be placed in the tree; leaving it running
    // would be a session nobody owns.
    await started.session.destroyAndWait().catch(() => {});
    throw new SessionSpawnError(
      'spawn_failed',
      error instanceof Error ? error.message : 'Could not record the session relation',
    );
  }

  try {
    await started.session.send({ type: 'prompt', message: prompt });
  } catch (error) {
    await started.session.destroyAndWait().catch(() => {});
    throw new SessionSpawnError(
      'spawn_failed',
      `${harnessDescriptor(harness)?.label ?? harness} refused the first prompt: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return {
    sessionId: started.realSessionId,
    harness,
    parentSessionId,
    depth,
  };
}
