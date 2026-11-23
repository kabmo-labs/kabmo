/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The board's operations, shared by the panel's RPC and the MCP child.
 *
 * Every one of them is the same three steps — read the board, read the card,
 * write the card under the lock — because the two writers must not each invent
 * their own. `move` is the one an agent uses most, and it carries the rule the
 * whole design turns on: a move into a stage that RUNS a session does not start
 * one. It answers `next: "start_work_required"` and the panel offers the button,
 * because a spawn nobody asked for is worse than one click.
 */

import fs from 'fs';
import path from 'path';

import {
  STAGE_ID,
  START_STAGE,
  type Board,
  type BoardRead,
  type BoardSnapshot,
  type Card,
  type CardSummary,
  type CardDetail,
  type Stage,
} from '../protocol';
import { KanbanError, boardDir, hasBoard, boardFile, withWriteLock, writeJsonAtomic } from './fs';
import { initBoard, readBoard, stageOf } from './board';
import { createCard, deleteCard, listCards, mutateCard, readCard, validateCard } from './cards';

/** What a move answers. */
export interface MoveResult {
  card: Card;
  /** Set when the target stage runs a session and the card has none. */
  next?: 'start_work_required';
}

/** The whole board, slim. A missing board is a `no_board` refusal, not an empty one. */
export async function snapshot(dataDir: string): Promise<BoardSnapshot> {
  const board = await readBoard(dataDir);
  const { cards, errors } = await listCards(dataDir);
  // The revision is a CONTENT stamp, not a counter: two readers (a panel and a
  // second tab) must agree on it without talking to each other, and a watcher
  // event can then be compared against what the caller already has.
  const revision = await contentRevision(dataDir, cards);
  return { dataDir: boardDir(dataDir), revision, board, cards, errors };
}

/**
 * A cheap stamp over the card files' size + mtime.
 *
 * Reading every card to hash it would cost the same as the read the caller is
 * about to do; `stat` per file is what a watcher can afford on every tick.
 */
async function contentRevision(dataDir: string, cards: readonly CardSummary[]): Promise<number> {
  let stamp = 0;
  for (const card of cards) {
    try {
      const stat = await fs.promises.stat(path.join(boardDir(dataDir), 'cards', `${card.id}.json`));
      stamp = (stamp * 31 + Math.round(stat.mtimeMs) + stat.size) % Number.MAX_SAFE_INTEGER;
    } catch {
      // A card that vanished mid-walk is the watcher's business, not the read's.
    }
  }
  return stamp;
}

/**
 * The board, or the fact that it does not exist yet.
 *
 * `snapshot` throws `no_board` for callers that require a board (a move cannot
 * invent one); this is the read the PANEL makes, where absence is a screen.
 */
export async function readBoardState(dataDir: string): Promise<BoardRead> {
  if (!(await hasBoard(dataDir))) return { exists: false, dataDir: boardDir(dataDir) };
  return { exists: true, ...(await snapshot(dataDir)) };
}

/** Create a board, then answer it. */
export async function createBoard(dataDir: string): Promise<BoardSnapshot> {
  if (!(await hasBoard(dataDir))) await initBoard(dataDir);
  return snapshot(dataDir);
}

/** One card with its stage, for the sheet. */
export async function cardDetail(dataDir: string, id: string): Promise<CardDetail> {
  const board = await readBoard(dataDir);
  const { card } = await readCard(dataDir, id);
  return { card, board };
}

/** Add a card. The workspace stamp is the caller's, never the server's cwd. */
export async function addCard(
  dataDir: string,
  input: { title: string; status?: string; workspace?: string | null; priority?: number; task?: Partial<Card['task']> },
): Promise<Card> {
  const board = await readBoard(dataDir);
  const status = input.status ?? 'open';
  if (!stageOf(board, status)) {
    throw new KanbanError('invalid', `Stage "${status}" does not exist.`);
  }
  return createCard(dataDir, { ...input, status });
}

/** Move a card between stages. */
export async function moveCard(
  dataDir: string,
  id: string,
  status: string,
  baseUpdatedAt?: string,
): Promise<MoveResult> {
  const board = await readBoard(dataDir);
  const stage = stageOf(board, status);
  if (!stage) throw new KanbanError('invalid', `Stage "${status}" does not exist.`);
  const card = await mutateCard(
    dataDir,
    id,
    (current) => ({ ...current, status, movedAt: new Date().toISOString() }),
    { baseUpdatedAt },
  );
  return stage.session && !card.sessionId ? { card, next: 'start_work_required' } : { card };
}

/** Change the fields the board owns. A field absent from the patch is untouched. */
export async function updateCard(
  dataDir: string,
  id: string,
  patch: { title?: string; priority?: number; workspace?: string | null; task?: Partial<Card['task']> },
  baseUpdatedAt?: string,
): Promise<Card> {
  return mutateCard(
    dataDir,
    id,
    (current) => {
      const next: Card = {
        ...current,
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
        ...(patch.workspace !== undefined ? { workspace: patch.workspace } : {}),
        ...(patch.task
          ? {
              task: {
                ...current.task,
                ...patch.task,
                images: patch.task.images ?? current.task.images,
              },
            }
          : {}),
      };
      validateCard(next);
      return next;
    },
    { baseUpdatedAt },
  );
}

/** Link a session, or unlink it. */
export async function linkSession(dataDir: string, id: string, sessionId: string | null): Promise<Card> {
  return mutateCard(dataDir, id, (current) => ({ ...current, sessionId }));
}

/**
 * Claim a card for a session: record it and land in the working stage.
 *
 * One write, so a claim cannot half-apply — a card that says In Progress with no
 * session is exactly the state the pill would then have to apologise for.
 */
export async function claimCard(dataDir: string, id: string, sessionId?: string): Promise<Card> {
  const board = await readBoard(dataDir);
  const start = stageOf(board, START_STAGE) ?? board.stages.find((stage) => stage.session);
  return mutateCard(dataDir, id, (current) => ({
    ...current,
    ...(sessionId ? { sessionId } : {}),
    ...(start ? { status: start.id, movedAt: new Date().toISOString() } : {}),
  }));
}

/** Remove a card. */
export async function removeCard(dataDir: string, id: string): Promise<void> {
  await deleteCard(dataDir, id);
}

/** Replace the stage list. Refuses a duplicate or an unreachable id. */
export async function saveStages(
  dataDir: string,
  stages: Board['stages'],
): Promise<BoardSnapshot> {
  const board = await readBoard(dataDir);
  const seen = new Set<string>();
  for (const stage of stages) {
    // The id becomes a value in every card file and a lane key in the panel, so
    // it is validated as an identifier rather than as display text.
    if (!STAGE_ID.test(stage.id)) {
      throw new KanbanError('invalid', `"${stage.id}" is not a stage id (lowercase, underscores, 32 max).`);
    }
    if (seen.has(stage.id)) throw new KanbanError('invalid', `Stage "${stage.id}" is listed twice.`);
    seen.add(stage.id);
    if (!stage.label.trim()) throw new KanbanError('invalid', `Stage "${stage.id}" needs a label.`);
  }
  await withWriteLock(dataDir, async () => {
    await writeJsonAtomic(boardFile(dataDir), { ...board, stages, updatedAt: new Date().toISOString() });
  });
  return snapshot(dataDir);
}

/** Replace the board's defaults. */
export async function saveDefaults(dataDir: string, defaults: Board['defaults']): Promise<BoardSnapshot> {
  const board = await readBoard(dataDir);
  await withWriteLock(dataDir, async () => {
    await writeJsonAtomic(boardFile(dataDir), { ...board, defaults, updatedAt: new Date().toISOString() });
  });
  return snapshot(dataDir);
}

/**
 * The stage that ends the board: the LAST one that does not run a session.
 *
 * Not the literal id `done`: a board may rename it or add a lane after it, and a
 * next-card query that hard-coded the id would keep offering finished work from
 * a stage nobody named `done`.
 */
export function terminalStageId(board: { stages: readonly Stage[] }): string {
  const terminal = [...board.stages].reverse().find((stage) => !stage.session);
  return terminal?.id ?? 'done';
}

/** The highest-priority card that is not done and has no live session. */
export async function nextCard(dataDir: string, workspace?: string | null): Promise<Card | null> {
  const board = await readBoard(dataDir);
  const { cards } = await listCards(dataDir);
  const done = new Set([terminalStageId(board)]);
  const candidates = cards
    .filter((card) => !done.has(card.status))
    .filter((card) => workspace === undefined || card.workspace === workspace)
    .sort((left, right) => left.priority - right.priority || right.updatedAt.localeCompare(left.updatedAt));
  const first = candidates[0];
  if (!first) return null;
  const { card } = await readCard(dataDir, first.id);
  return card;
}

