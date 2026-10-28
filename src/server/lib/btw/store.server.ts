/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * SQLite-backed BTW store (`btw_topics` / `btw_turns`).
 *
 * A side question is a topic: an independent first question plus explicit
 * follow-ups, scoped to the parent session. Rows mirror what the panel shows,
 * so history survives a reload, a server restart, and the death of the side
 * session's omp child — a follow-up resumes the topic's own session file,
 * which already carries the parent's context and every turn before it.
 *
 * `leaf_id` is the parent session's transcript leaf when the topic started.
 * Promotion refuses when the parent has moved on, exactly like omp's own
 * `/btw` branch guard ("session changed since /btw started").
 *
 * `thinking_level` holds the chat's thinking SELECTOR (`auto` included), not the
 * effort the side child resolved; `approval_mode` is no longer written — a side
 * child runs `--no-tools`, so there is no approval gate to configure. Both
 * columns stay in the schema for existing rows.
 */

import { getDb } from '@/server/db.server';
import type { BtwModel, BtwTopic, BtwTurn, BtwTurnStatus, ChatMessageData } from '@/shared/types';

interface TopicRow {
  id: string;
  session_id: string;
  title: string;
  provider: string | null;
  model_id: string | null;
  model_name: string | null;
  thinking_level: string | null;
  approval_mode: string | null;
  leaf_id: string | null;
  promoted_session_id: string | null;
  created_at: number;
  updated_at: number;
}

interface TurnRow {
  topic_id: string;
  turn_index: number;
  question: string;
  answer: string;
  messages: string;
  status: string;
  created_at: number;
  updated_at: number;
}

const TURN_STATUSES: Record<string, true> = {
  running: true,
  complete: true,
  cancelled: true,
  error: true,
  interrupted: true,
};

export function isBtwTurnStatus(value: unknown): value is BtwTurnStatus {
  return typeof value === 'string' && value in TURN_STATUSES;
}

function rowToTopic(row: TopicRow): BtwTopic {
  const model: BtwModel | undefined =
    row.provider && row.model_id
      ? { provider: row.provider, id: row.model_id, ...(row.model_name ? { name: row.model_name } : {}) }
      : undefined;
  return {
    id: row.id,
    sessionId: row.session_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(model ? { model } : {}),
    ...(row.thinking_level ? { thinkingLevel: row.thinking_level } : {}),
    ...(row.promoted_session_id ? { promotedSessionId: row.promoted_session_id } : {}),
    turns: [],
  };
}

function rowToTurn(row: TurnRow): BtwTurn {
  return {
    index: row.turn_index,
    question: row.question,
    answer: row.answer,
    messages: parseMessages(row.messages),
    status: isBtwTurnStatus(row.status) ? row.status : 'interrupted',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** A turn's stored conversation. A row written before the column existed (or a
 *  corrupted one) reads as an empty conversation rather than throwing. */
function parseMessages(raw: string | null | undefined): ChatMessageData[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? (value as ChatMessageData[]) : [];
  } catch {
    return [];
  }
}

/** Every topic of a session, oldest first, each with its turns in order. */
export async function listBtwTopics(sessionId: string): Promise<BtwTopic[]> {
  const db = await getDb();
  const topics = ((await db.all(
    'SELECT * FROM btw_topics WHERE session_id = ? ORDER BY created_at ASC, id ASC',
    [sessionId],
  )) as TopicRow[]).map(rowToTopic);
  if (topics.length === 0) return topics;

  const placeholders = topics.map(() => '?').join(', ');
  const turns = (await db.all(
    `SELECT * FROM btw_turns WHERE topic_id IN (${placeholders}) ORDER BY topic_id ASC, turn_index ASC`,
    topics.map((topic) => topic.id),
  )) as TurnRow[];

  const byTopic = new Map<string, BtwTurn[]>(topics.map((topic) => [topic.id, []]));
  for (const row of turns) byTopic.get(row.topic_id)?.push(rowToTurn(row));
  return topics.map((topic) => ({ ...topic, turns: byTopic.get(topic.id) ?? [] }));
}

/** One topic with its turns, or undefined when the id is unknown. */
export async function getBtwTopic(topicId: string): Promise<BtwTopic | undefined> {
  const db = await getDb();
  const row = (await db.get('SELECT * FROM btw_topics WHERE id = ?', [topicId])) as TopicRow | undefined;
  if (!row) return undefined;
  const turns = (await db.all(
    'SELECT * FROM btw_turns WHERE topic_id = ? ORDER BY turn_index ASC',
    [topicId],
  )) as TurnRow[];
  return { ...rowToTopic(row), turns: turns.map(rowToTurn) };
}

export interface NewBtwTopicInput {
  sessionId: string;
  title: string;
  model?: BtwModel;
  /** The chat's thinking selector, so the side child classifies like the chat. */
  thinkingLevel?: string;
}

export async function createBtwTopic(input: NewBtwTopicInput): Promise<BtwTopic> {
  const db = await getDb();
  const now = Date.now();
  const row: TopicRow = {
    id: crypto.randomUUID(),
    session_id: input.sessionId,
    title: input.title,
    provider: input.model?.provider ?? null,
    model_id: input.model?.id ?? null,
    model_name: input.model?.name ?? null,
    thinking_level: input.thinkingLevel ?? null,
    approval_mode: null,
    leaf_id: null,
    promoted_session_id: null,
    created_at: now,
    updated_at: now,
  };
  await db.run(
    `INSERT INTO btw_topics
       (id, session_id, title, provider, model_id, model_name, thinking_level, approval_mode, leaf_id, promoted_session_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    [
      row.id,
      row.session_id,
      row.title,
      row.provider,
      row.model_id,
      row.model_name,
      row.thinking_level,
      row.approval_mode,
      row.leaf_id,
      now,
      now,
    ],
  );
  return rowToTopic(row);
}

/** Append a question to a topic; returns the new turn's index. */
export async function appendBtwTurn(topicId: string, question: string): Promise<number> {
  const db = await getDb();
  const now = Date.now();
  const next = (await db.get(
    'SELECT COALESCE(MAX(turn_index), -1) + 1 AS next FROM btw_turns WHERE topic_id = ?',
    [topicId],
  )) as { next: number } | undefined;
  const turnIndex = next?.next ?? 0;
  await db.run(
    `INSERT INTO btw_turns (topic_id, turn_index, question, answer, status, created_at, updated_at)
     VALUES (?, ?, ?, '', 'running', ?, ?)`,
    [topicId, turnIndex, question, now, now],
  );
  await db.run('UPDATE btw_topics SET updated_at = ? WHERE id = ?', [now, topicId]);
  return turnIndex;
}

/** Patch one turn's answer, conversation and/or status. */
export async function updateBtwTurn(
  topicId: string,
  turnIndex: number,
  patch: { answer?: string; status?: BtwTurnStatus; messages?: ChatMessageData[] },
): Promise<void> {
  const db = await getDb();
  const sets: string[] = ['updated_at = ?'];
  const values: (string | number)[] = [Date.now()];
  if (typeof patch.answer === 'string') {
    sets.push('answer = ?');
    values.push(patch.answer);
  }
  if (patch.status !== undefined) {
    sets.push('status = ?');
    values.push(patch.status);
  }
  if (patch.messages !== undefined) {
    sets.push('messages = ?');
    values.push(JSON.stringify(patch.messages));
  }
  await db.run(`UPDATE btw_turns SET ${sets.join(', ')} WHERE topic_id = ? AND turn_index = ?`, [
    ...values,
    topicId,
    turnIndex,
  ]);
}

/** Settle every still-running turn of a topic — the side session died or was
 *  cancelled, so nothing will ever complete them. */
export async function settleRunningBtwTurns(topicId: string, status: BtwTurnStatus): Promise<void> {
  const db = await getDb();
  await db.run(
    "UPDATE btw_turns SET status = ?, updated_at = ? WHERE topic_id = ? AND status = 'running'",
    [status, Date.now(), topicId],
  );
}

/** Record the parent-transcript leaf a topic was snapshotted at. */
export async function setBtwTopicLeaf(topicId: string, leafId: string): Promise<void> {
  const db = await getDb();
  await db.run('UPDATE btw_topics SET leaf_id = ? WHERE id = ?', [leafId, topicId]);
}

/** The parent-transcript leaf this topic was snapshotted at, when known. */
export async function readBtwTopicLeaf(topicId: string): Promise<string | null> {
  const db = await getDb();
  const row = (await db.get('SELECT leaf_id FROM btw_topics WHERE id = ?', [topicId])) as { leaf_id: string | null } | undefined;
  return row?.leaf_id ?? null;
}

export async function setBtwTopicModel(topicId: string, model: BtwModel): Promise<void> {
  const db = await getDb();
  await db.run('UPDATE btw_topics SET provider = ?, model_id = ?, model_name = ?, updated_at = ? WHERE id = ?', [
    model.provider,
    model.id,
    model.name ?? null,
    Date.now(),
    topicId,
  ]);
}

export async function setBtwTopicPromoted(topicId: string, promotedSessionId: string): Promise<void> {
  const db = await getDb();
  await db.run('UPDATE btw_topics SET promoted_session_id = ?, updated_at = ? WHERE id = ?', [
    promotedSessionId,
    Date.now(),
    topicId,
  ]);
}

export async function deleteBtwTopic(topicId: string): Promise<boolean> {
  const db = await getDb();
  const result = await db.run('DELETE FROM btw_topics WHERE id = ?', [topicId]);
  await db.run('DELETE FROM btw_turns WHERE topic_id = ?', [topicId]);
  return result.changes > 0;
}
