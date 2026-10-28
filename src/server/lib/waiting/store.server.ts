/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * SQLite store for waiting prompts (`waiting_prompts`).
 *
 * Two rules shape this file:
 *
 *   - **The claim is a write.** `claimWaitingPrompt` flips `waiting →
 *     dispatched` in one statement and reports whether it won, so two sweeps —
 *     or two Kabmo instances on the shared database — can never both spawn a
 *     session for one prompt.
 *   - **A terminal row is kept for a while.** The client learns that a prompt
 *     was dispatched (and which session it became) by reading this list, so a
 *     row that vanished the instant it was claimed would leave a sidebar row
 *     with nothing to adopt. Rows are pruned by age instead.
 */

import { getDb } from '@/server/db.server';
import { isApprovalMode } from '@/shared/lib/omp/config/access-mode';
import { normalizeModel } from '@/server/lib/queue/store.server';
import type { Attachment, QueuedMessageModel } from '@/shared/types/chat';
import type { WaitingPrompt, WaitingPromptModes, WaitingPromptStatus } from '@/shared/types/waiting';

/** How long a finished (dispatched/cancelled/error) row stays readable. */
export const WAITING_RETENTION_MS = 24 * 60 * 60 * 1000;

interface WaitingRow {
  id: string;
  pending_id: string | null;
  depends_on: string;
  depends_on_title: string | null;
  message: string;
  attachments: string;
  provider: string | null;
  model_id: string | null;
  thinking_level: string | null;
  access_mode: string | null;
  modes: string | null;
  cwd: string;
  folder_id: number | null;
  status: string;
  session_id: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

const STATUSES: readonly WaitingPromptStatus[] = ['waiting', 'dispatched', 'cancelled', 'error'];

function isStatus(value: unknown): value is WaitingPromptStatus {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value);
}

/** A JSON column, or null when the text is absent or unparseable. */
function parseColumn(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function readModel(row: WaitingRow): QueuedMessageModel | null {
  if (!row.provider || !row.model_id) return null;
  return {
    provider: row.provider,
    modelId: row.model_id,
    thinkingLevel: row.thinking_level ?? 'auto',
    accessMode: isApprovalMode(row.access_mode) ? row.access_mode : 'always-ask',
  };
}

function readModes(raw: string | null): WaitingPromptModes | null {
  const parsed = parseColumn(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const modes = parsed as Record<string, unknown>;
  return { plan: modes.plan === true, goal: modes.goal === true };
}

function rowToWaitingPrompt(row: WaitingRow): WaitingPrompt {
  const attachments = parseColumn(row.attachments);
  return {
    id: row.id,
    pendingId: row.pending_id,
    dependsOn: row.depends_on,
    dependsOnTitle: row.depends_on_title,
    prompt: row.message,
    attachments: Array.isArray(attachments) ? (attachments as Attachment[]) : [],
    model: readModel(row),
    modes: readModes(row.modes),
    cwd: row.cwd,
    folderId: row.folder_id,
    status: isStatus(row.status) ? row.status : 'error',
    sessionId: row.session_id,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface WaitingPromptInput {
  pendingId?: string | null;
  dependsOn: string;
  dependsOnTitle?: string | null;
  prompt: string;
  attachments?: unknown;
  model?: unknown;
  modes?: WaitingPromptModes | null;
  cwd: string;
  folderId?: number | null;
}

/** Every row a client may still need: all `waiting` plus recent terminal ones. */
export async function listWaitingPrompts(now = Date.now()): Promise<WaitingPrompt[]> {
  const db = await getDb();
  const rows = (await db.all(
    `SELECT * FROM waiting_prompts
      WHERE status = 'waiting' OR updated_at >= ?
      ORDER BY created_at ASC`,
    [now - WAITING_RETENTION_MS],
  )) as WaitingRow[];
  return rows.map(rowToWaitingPrompt);
}

export async function getWaitingPrompt(id: string): Promise<WaitingPrompt | null> {
  const db = await getDb();
  const row = (await db.get('SELECT * FROM waiting_prompts WHERE id = ?', [id])) as WaitingRow | undefined;
  return row ? rowToWaitingPrompt(row) : null;
}

/** Rows still waiting on `sessionId` (used when that session is deleted). */
export async function listWaitingOn(sessionId: string): Promise<WaitingPrompt[]> {
  const db = await getDb();
  const rows = (await db.all(
    "SELECT * FROM waiting_prompts WHERE status = 'waiting' AND depends_on = ? ORDER BY created_at ASC",
    [sessionId],
  )) as WaitingRow[];
  return rows.map(rowToWaitingPrompt);
}

/** Insert one prompt. Returns the stored row (id and clock filled in). */
export async function createWaitingPrompt(input: WaitingPromptInput): Promise<WaitingPrompt> {
  const db = await getDb();
  const id = `wait-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const model = normalizeModel(input.model);
  const now = Date.now();
  await db.run(
    `INSERT INTO waiting_prompts
       (id, pending_id, depends_on, depends_on_title, message, attachments,
        provider, model_id, thinking_level, access_mode, modes, cwd, folder_id,
        status, session_id, error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting', NULL, NULL, ?, ?)`,
    [
      id,
      input.pendingId ?? null,
      input.dependsOn,
      input.dependsOnTitle ?? null,
      input.prompt,
      JSON.stringify(Array.isArray(input.attachments) ? input.attachments : []),
      model?.provider ?? null,
      model?.modelId ?? null,
      model?.thinkingLevel ?? null,
      model?.accessMode ?? null,
      input.modes ? JSON.stringify({ plan: input.modes.plan === true, goal: input.modes.goal === true }) : null,
      input.cwd,
      input.folderId ?? null,
      now,
      now,
    ],
  );
  const created = await getWaitingPrompt(id);
  if (!created) throw new Error('Waiting prompt was not stored');
  return created;
}

/**
 * Claim one prompt for dispatch. True only for the caller that moved it.
 *
 * This is the whole concurrency story: the sweep may run in several processes,
 * and a prompt must produce exactly one session.
 */
export async function claimWaitingPrompt(id: string): Promise<boolean> {
  const db = await getDb();
  const result = await db.run(
    "UPDATE waiting_prompts SET status = 'dispatched', updated_at = ? WHERE id = ? AND status = 'waiting'",
    [Date.now(), id],
  );
  return result.changes > 0;
}

/** Record the session a claimed prompt became. */
export async function markWaitingDispatched(id: string, sessionId: string): Promise<void> {
  const db = await getDb();
  await db.run(
    "UPDATE waiting_prompts SET session_id = ?, updated_at = ? WHERE id = ? AND status = 'dispatched'",
    [sessionId, Date.now(), id],
  );
}

/**
 * Return a claimed prompt to `waiting` — the dispatch threw before a session
 * existed, so the prompt has not been delivered and is still wanted.
 */
export async function requeueWaitingPrompt(id: string, error: string): Promise<void> {
  const db = await getDb();
  await db.run(
    "UPDATE waiting_prompts SET status = 'waiting', error = ?, updated_at = ? WHERE id = ? AND status = 'dispatched'",
    [error, Date.now(), id],
  );
}

/**
 * Terminal failure: the prompt will not be sent, and the client must say why.
 *
 * Covers BOTH a prompt still waiting and one already claimed: a dispatch that
 * spawned a session and then failed to deliver into it has still ended in
 * failure, and leaving the row at `dispatched` would tell the client a prompt
 * arrived when it did not.
 */
export async function failWaitingPrompt(id: string, error: string): Promise<void> {
  const db = await getDb();
  await db.run(
    "UPDATE waiting_prompts SET status = 'error', error = ?, updated_at = ? WHERE id = ? AND status IN ('waiting', 'dispatched')",
    [error, Date.now(), id],
  );
}

/** Count one dispatch attempt; returns the new count. */
export async function countWaitingAttempt(id: string): Promise<number> {
  const db = await getDb();
  await db.run('UPDATE waiting_prompts SET attempts = attempts + 1 WHERE id = ?', [id]);
  const row = (await db.get('SELECT attempts FROM waiting_prompts WHERE id = ?', [id])) as { attempts?: number } | undefined;
  return row?.attempts ?? 1;
}

/** Fail every prompt waiting on a session that no longer exists. */
export async function failWaitingOn(sessionId: string, reason: string): Promise<number> {
  const db = await getDb();
  const result = await db.run(
    "UPDATE waiting_prompts SET status = 'error', error = ?, updated_at = ? WHERE status = 'waiting' AND depends_on = ?",
    [reason, Date.now(), sessionId],
  );
  return result.changes;
}

/** Cancel one prompt. False when it was already claimed (or is unknown). */
export async function cancelWaitingPrompt(id: string): Promise<boolean> {
  const db = await getDb();
  const result = await db.run(
    "UPDATE waiting_prompts SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'waiting'",
    [Date.now(), id],
  );
  return result.changes > 0;
}

/** Drop rows past retention; returns how many went. */
export async function pruneWaitingPrompts(now = Date.now()): Promise<number> {
  const db = await getDb();
  const result = await db.run(
    "DELETE FROM waiting_prompts WHERE status <> 'waiting' AND updated_at < ?",
    [now - WAITING_RETENTION_MS],
  );
  return result.changes;
}
