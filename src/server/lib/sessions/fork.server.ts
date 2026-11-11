/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Fork a session: a new session that starts with the source's history.
 *
 * The two transports answer this differently, and neither is a rewrite of the
 * source:
 *
 *  - omp: copy the transcript, cut it at the anchor's turn start, rewrite the
 *    header id and title, write a new `<ts>_<id>.jsonl`, then resume that file.
 *    The source bytes are never touched.
 *  - ACP: ask the agent for `session/fork`. The agent owns the history, so the
 *    returned session id is the child; Kabmo records the source edge and does
 *    not pretend to hold a local transcript.
 *
 * A fork is NOT a child: it writes `source_session_id` + `origin_kind`, never
 * `parent_session_id`, so it stays out of the parent tree and sends no outcome
 * notification. A user can reparent it afterwards.
 */

import * as path from 'node:path';
import { loadPersistedAccessMode } from '@/shared/lib/omp/config/access-mode.server';
import { startRpcSession } from '@/server/lib/omp/rpc/session-registry';
import { startAcpSession } from '@/server/lib/harness/spawn.server';
import { freshProbe } from '@/server/lib/harness/probe-cache.server';
import { clearSessionFileCaches } from '@/server/lib/omp/session/files';
import { findSessionFileById } from '@/server/lib/omp/session/locator';
import { buildTruncatedBody, isRewindCutPoint } from '@/server/lib/omp/session/rewind-file';
import {
  branchTranscript,
  completeLines,
  parseJsonObject,
  transcriptTitle,
} from '@/server/lib/omp/session/transcript-copy';
import type { HarnessId } from '@/shared/lib/harness/catalog';
import { airForkPoint, harnessForksAtMessage } from '@/shared/lib/harness/fork';
import type { SelectedModel } from '@/shared/types/models';
import type { AgentImage } from '@/shared/types/omp/agent';
import type { ApprovalMode } from '@/shared/lib/omp/config/access-mode';
import {
  createSessionRelation,
  deleteSessionRelations,
  listForkRelations,
} from '@/server/lib/sessions/relations.server';
import { isSessionArchived, resolveSessionRef, sessionExists } from '@/server/lib/sessions/resolve.server';
import {
  agentEnvironment,
  createAgentToken,
  rememberAgentToken,
} from '@/server/lib/sessions/agent-token.server';

export type SessionForkErrorCode =
  | 'source_not_found'
  | 'source_archived'
  | 'cwd_required'
  | 'anchor_not_found'
  | 'anchor_unsupported'
  | 'fork_unsupported'
  | 'fork_requires_checkpoint'
  | 'fork_failed';

export class SessionForkError extends Error {
  constructor(
    readonly code: SessionForkErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SessionForkError';
  }
}

export interface ForkedSession {
  readonly sessionId: string;
  send(command: Record<string, unknown>): Promise<unknown>;
  destroyAndWait(): Promise<void>;
}

export interface ForkSessionDeps {
  startRpc(
    sessionId: string,
    sessionFile: string,
    cwd: string,
    accessMode: ApprovalMode,
    model: SelectedModel | null,
    env: Record<string, string>,
  ): Promise<{ session: ForkedSession; realSessionId: string }>;
  startAcp(request: {
    harness: HarnessId;
    sessionId: string;
    forkAgentSessionId: string;
    /** The fork point an agent extension reads; omitted forks the whole chat. */
    forkMeta?: Record<string, unknown>;
    cwd: string;
    accessMode: ApprovalMode;
    model: SelectedModel | null;
    thinkingLevel: string | null;
    env: Record<string, string>;
  }): Promise<{ session: ForkedSession; realSessionId: string }>;
  probeForkSupported(harness: HarnessId): Promise<boolean>;
}

const defaultDeps: ForkSessionDeps = {
  async startRpc(sessionId, sessionFile, cwd, accessMode, model, env) {
    return startRpcSession(sessionId, sessionFile, cwd, cwd, accessMode, env, model ?? undefined);
  },
  startAcp: (request) => startAcpSession(request),
  async probeForkSupported(harness) {
    const probe = await freshProbe(harness);
    return probe?.capabilities.forkSession === true;
  },
};

export interface ForkSessionInput {
  sourceSessionId: string;
  /** A message/entry id; the fork cuts at the start of its turn. Omit for tip. */
  anchorEntryId?: string | null;
  prompt?: string | null;
  /** Images the composer attached to the first prompt of the branch. */
  images?: AgentImage[] | null;
  /** The composer's model pick; applied before the branch's first prompt. */
  model?: SelectedModel | null;
  thinkingLevel?: string | null;
  /** The composer's approval pick; omitted keeps the persisted setting. */
  accessMode?: ApprovalMode | null;
  title?: string | null;
  cwd?: string | null;
  visibility?: 'visible' | 'hidden';
  lifecycleOwnerSessionId?: string | null;
}

export interface ForkSessionResult {
  sessionId: string;
  sourceSessionId: string;
  originKind: 'fork';
}

/**
 * The record index the cut lands on.
 *
 * An anchor on a user turn branches BEFORE it (that is "do not send this
 * message"). An anchor anywhere else — an assistant reply, a tool call —
 * branches AFTER the turn that contains it, so the reply the user pointed at is
 * part of the fork. No anchor (or an id the file does not carry) is the tip.
 */
function cutIndexFor(records: Array<Record<string, unknown> | null>, anchorEntryId: string | null): number | null {
  if (!anchorEntryId) return null;
  const anchorIndex = records.findIndex((record) => record?.id === anchorEntryId);
  if (anchorIndex === -1) return null;

  let turnStart = -1;
  for (let index = anchorIndex; index >= 0; index -= 1) {
    if (isRewindCutPoint(records[index])) {
      turnStart = index;
      break;
    }
  }
  if (turnStart === -1) {
    const headerIndex = records.findIndex((record) => record?.type === 'session');
    return headerIndex === -1 ? 0 : headerIndex + 1;
  }
  if (isRewindCutPoint(records[anchorIndex])) return turnStart;

  const nextTurn = records.findIndex(
    (record, index) => index > anchorIndex && isRewindCutPoint(record),
  );
  return nextTurn === -1 ? records.length : nextTurn;
}

function newBranchTitle(sourceTitle: string, sourceSessionId: string, forkCount: number): string {
  return `(${forkCount}) ${sourceTitle.trim() || sourceSessionId}`;
}

async function writeBranchFile(input: {
  sourceFile: string;
  lines: string[];
  newId: string;
  timestamp: string;
  title: string;
}): Promise<string> {
  const body = branchTranscript({
    lines: input.lines,
    newId: input.newId,
    timestamp: input.timestamp,
    title: input.title,
    parentSessionFile: input.sourceFile,
  });
  const fileName = `${input.timestamp.replace(/[:.]/g, '-')}_${input.newId}.jsonl`;
  const target = path.join(path.dirname(input.sourceFile), fileName);
  if (await Bun.file(target).exists()) {
    throw new SessionForkError('fork_failed', `A session file already exists at ${fileName}`);
  }
  await Bun.write(target, body);
  clearSessionFileCaches();
  return target;
}

/** Fork a session at its tip or at an anchored turn. */
export async function forkSession(
  input: ForkSessionInput,
  deps: ForkSessionDeps = defaultDeps,
): Promise<ForkSessionResult> {
  if (!(await sessionExists(input.sourceSessionId))) {
    throw new SessionForkError('source_not_found', 'Source session not found');
  }
  if (await isSessionArchived(input.sourceSessionId)) {
    throw new SessionForkError('source_archived', 'Cannot fork an archived session');
  }
  const source = await resolveSessionRef(input.sourceSessionId);
  const cwd = input.cwd || source.cwd;
  if (!cwd) throw new SessionForkError('cwd_required', 'The source has no working directory');

  const accessMode = input.accessMode ?? await loadPersistedAccessMode();
  const token = createAgentToken();
  const env = agentEnvironment(token);
  const model = input.model ?? null;
  const thinkingLevel = input.thinkingLevel ?? null;
  const forkCount = (await listForkRelations(input.sourceSessionId)).length + 1;
  const sourceFile = await findSessionFileById(input.sourceSessionId);
  let started: { session: ForkedSession; realSessionId: string };
  let createdFile: string | null = null;

  if (sourceFile) {
    const raw = await Bun.file(sourceFile).text();
    const lines = completeLines(raw);
    const records = lines.map((line) => parseJsonObject(line));
    // An id the file does not carry is usually an overlay-only row (a builtin
    // command's message). Silently forking at the tip would hand back history
    // the user did not point at, so it is a refusal with a code.
    if (input.anchorEntryId && !records.some((record) => record?.id === input.anchorEntryId)) {
      throw new SessionForkError(
        'anchor_not_found',
        `The transcript has no entry ${input.anchorEntryId}; a builtin command's row is stored by Kabmo only, so fork at a chat turn instead.`,
      );
    }
    const cutIndex = cutIndexFor(records, input.anchorEntryId ?? null);
    const kept =
      cutIndex === null
        ? lines
        : completeLines(buildTruncatedBody(records, cutIndex).body);
    const newId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const title =
      input.title?.trim() || newBranchTitle(transcriptTitle(lines), input.sourceSessionId, forkCount);
    createdFile = await writeBranchFile({ sourceFile, lines: kept, newId, timestamp, title });
    try {
      started = await deps.startRpc(newId, createdFile, cwd, accessMode, model, env);
    } catch (error) {
      await Bun.file(createdFile).delete().catch(() => {});
      throw new SessionForkError(
        'fork_failed',
        error instanceof Error ? error.message : 'Could not resume the fork',
      );
    }
  } else {
    const harness = source.harness;
    if (!harness || harness === 'omp-rpc') {
      throw new SessionForkError('fork_unsupported', 'This session has no transcript to fork');
    }
    // `session/fork` copies the agent's WHOLE history and takes no anchor.
    // The AIR adapters (claude, codex) read a fork point from `_meta` and keep
    // the history up to that message. Every other agent would silently hand
    // back turns the user did not point at, so an anchor there is refused
    // instead of being answered with the tip.
    if (input.anchorEntryId && !harnessForksAtMessage(harness)) {
      throw new SessionForkError(
        'anchor_unsupported',
        `${harness} keeps this chat's history in its own store, so it can only be forked whole.`,
      );
    }
    if (!(await deps.probeForkSupported(harness))) {
      throw new SessionForkError('fork_unsupported', `${harness} does not support session/fork`);
    }
    try {
      started = await deps.startAcp({
        harness,
        sessionId: `__new__${Bun.randomUUIDv7()}`,
        forkAgentSessionId: source.agentSessionId || input.sourceSessionId,
        ...(input.anchorEntryId ? { forkMeta: airForkPoint(input.anchorEntryId) } : {}),
        cwd,
        accessMode,
        model,
        thinkingLevel,
        env,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      // zcode advertises session/fork but refuses until the workspace has a
      // checkpoint. That is a state requirement, not a missing capability, and
      // the user can satisfy it by making a change first.
      if (/workspace checkpoint/i.test(detail)) {
        throw new SessionForkError(
          'fork_requires_checkpoint',
          'This harness needs a workspace checkpoint before it can fork: make a change in the source session first.',
        );
      }
      throw new SessionForkError('fork_failed', detail || 'The agent refused session/fork');
    }
  }

  // The RPC fork RESUMES the source transcript, which carries its own model
  // and thinking level. A pick made in the fork composer is applied on top,
  // before the branch's first prompt — ACP already received both at spawn.
  if (sourceFile) {
    if (model) await started.session.send({ type: 'set_model', ...model }).catch(() => {});
    if (thinkingLevel) {
      await started.session.send({ type: 'set_thinking_level', level: thinkingLevel }).catch(() => {});
    }
  }

  try {
    await rememberAgentToken(started.realSessionId, token);
    await createSessionRelation({
      sessionId: started.realSessionId,
      sourceSessionId: input.sourceSessionId,
      originKind: 'fork',
      lifecycleOwnerSessionId: input.lifecycleOwnerSessionId ?? null,
      visibility: input.visibility ?? 'visible',
    });
    const prompt = input.prompt?.trim() ?? '';
    if (prompt || input.images?.length) {
      await started.session.send({
        type: 'prompt',
        message: prompt,
        ...(input.images?.length ? { images: input.images } : {}),
      });
    }
  } catch (error) {
    await started.session.destroyAndWait().catch(() => {});
    await deleteSessionRelations(started.realSessionId).catch(() => {});
    if (createdFile) await Bun.file(createdFile).delete().catch(() => {});
    throw new SessionForkError(
      'fork_failed',
      error instanceof Error ? error.message : 'Could not record the fork',
    );
  }

  return {
    sessionId: started.realSessionId,
    sourceSessionId: input.sourceSessionId,
    originKind: 'fork',
  };
}
