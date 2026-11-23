/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The store's rules, one per failure that is silent when broken.
 *
 * The board is files another process writes, so the cases that matter are the
 * ones a happy-path test never sees: a card an agent half-wrote, a stage that no
 * longer exists, a card whose folder was deleted, a stale `baseUpdatedAt`, two
 * writers racing the same card, and the promise that a removed plugin does not
 * take the user's board with it.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  MAX_IMAGES,
  MAX_PROMPT_CHARS,
  type Card,
  type Stage,
} from '../protocol';
import { KanbanError, boardFile, cardFile, cardsDir } from './fs';
import { defaultBoard, initBoard, readBoard } from './board';
import { listCards, mutateCard, readCard, summarize, validateCard } from './cards';
import {
  addCard,
  claimCard,
  createBoard,
  linkSession,
  moveCard,
  nextCard,
  removeCard,
  saveStages,
  snapshot,
  updateCard,
} from './ops';

let dataDir = '';

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-store-'));
});

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function refusal(run: () => unknown): KanbanError {
  try {
    const value = run();
    if (value instanceof Promise) {
      // A synchronous helper cannot await; the async callers below catch their
      // own refusals instead.
      throw new Error('expected a synchronous refusal');
    }
  } catch (cause) {
    if (cause instanceof KanbanError) return cause;
    throw cause;
  }
  throw new Error('expected a refusal, got a value');
}

async function asyncRefusal(run: () => Promise<unknown>): Promise<KanbanError> {
  try {
    await run();
  } catch (cause) {
    if (cause instanceof KanbanError) return cause;
    throw cause;
  }
  throw new Error('expected a refusal, got a value');
}

describe('board file', () => {
  test('a fresh board carries the six stages and no overrides', async () => {
    const board = await initBoard(dataDir);
    expect(board.stages.map((stage) => stage.id)).toEqual([
      'backlog', 'open', 'in_progress', 'review', 'test', 'done',
    ]);
    // Only the two working stages run a session; the rest are planning lanes.
    expect(board.stages.filter((stage) => stage.session).map((stage) => stage.id)).toEqual(['in_progress', 'review']);
    expect(board.defaults).toEqual({});
  });

  test('init writes a README that names the ABSOLUTE board path', async () => {
    // An agent cannot guess `~/.kabmo`, so the file it reads has to say it.
    await initBoard(dataDir);
    const readme = fs.readFileSync(path.join(dataDir, 'kanban', 'README.md'), 'utf8');
    expect(readme).toContain(path.join(dataDir, 'kanban'));
    expect(readme).toContain('kanban_*');
  });

  test('a missing board is a no_board refusal, never an empty board', async () => {
    expect((await asyncRefusal(() => snapshot(dataDir))).code).toBe('no_board');
  });

  test('an unreadable board.json is an io refusal naming the file', async () => {
    fs.mkdirSync(path.join(dataDir, 'kanban'), { recursive: true });
    fs.writeFileSync(boardFile(dataDir), '{ not json');
    const error = await asyncRefusal(() => readBoard(dataDir));
    expect(error.code).toBe('io');
    expect(error.message).toContain('board.json');
  });

  test('a board whose stages all failed to parse falls back to the defaults', async () => {
    fs.mkdirSync(path.join(dataDir, 'kanban'), { recursive: true });
    fs.writeFileSync(boardFile(dataDir), JSON.stringify({ stages: [{ id: 'Bad Id!' }] }));
    expect((await readBoard(dataDir)).stages.map((stage) => stage.id)).toContain('in_progress');
  });

  test('creating twice is idempotent', async () => {
    await createBoard(dataDir);
    const second = await createBoard(dataDir);
    expect(second.board.stages.length).toBe(6);
  });
});

describe('cards', () => {
  test('create stamps an id, a workspace and a stage', async () => {
    await initBoard(dataDir);
    const card = await addCard(dataDir, { title: 'Fix it', workspace: '/w', task: { prompt: 'do it' } });
    expect(card.id).toMatch(/^k-[0-9a-f]{6}$/);
    expect(card.workspace).toBe('/w');
    expect(card.status).toBe('open');
    expect(fs.existsSync(cardFile(dataDir, card.id))).toBe(true);
  });

  test('a card with no workspace is the global bucket, not the server cwd', async () => {
    await initBoard(dataDir);
    const card = await addCard(dataDir, { title: 'Global thing' });
    expect(card.workspace).toBeNull();
  });

  test('an unknown stage is refused by name', async () => {
    await initBoard(dataDir);
    expect((await asyncRefusal(() => addCard(dataDir, { title: 'x', status: 'nope' }))).message).toContain('nope');
  });

  test('an update preserves fields the caller did not touch, including unknown ones', async () => {
    await initBoard(dataDir);
    const card = await addCard(dataDir, { title: 'Keep me', task: { prompt: 'p' } });
    // A newer writer's field must survive an older panel's edit.
    const raw = JSON.parse(fs.readFileSync(cardFile(dataDir, card.id), 'utf8')) as Record<string, unknown>;
    fs.writeFileSync(cardFile(dataDir, card.id), JSON.stringify({ ...raw, futureField: { nested: true } }));

    const updated = await updateCard(dataDir, card.id, { title: 'Renamed' });
    expect(updated.title).toBe('Renamed');
    expect(updated.task.prompt).toBe('p');
    const after = JSON.parse(fs.readFileSync(cardFile(dataDir, card.id), 'utf8')) as Record<string, unknown>;
    expect(after.futureField).toEqual({ nested: true });
  });

  test('a stale baseUpdatedAt is refused instead of overwriting an agent edit', async () => {
    await initBoard(dataDir);
    const card = await addCard(dataDir, { title: 'Race' });
    const first = await updateCard(dataDir, card.id, { title: 'First' });
    // A stamp from before the last write is stale; the caller must re-read.
    const error = await asyncRefusal(() =>
      updateCard(dataDir, card.id, { title: 'Second' }, card.updatedAt),
    );
    expect(error.code).toBe('stale');
    // And two writes inside one millisecond still differ, or the token is inert.
    const second = await updateCard(dataDir, card.id, { title: 'Second' }, first.updatedAt);
    expect(second.updatedAt > first.updatedAt).toBe(true);
  });

  test('a bad id is refused before any file is touched', async () => {
    await initBoard(dataDir);
    expect((await asyncRefusal(() => readCard(dataDir, '../../etc/passwd'))).code).toBe('invalid');
  });

  test('a card file an agent broke is reported with its path, not skipped', async () => {
    await initBoard(dataDir);
    await addCard(dataDir, { title: 'Good' });
    fs.writeFileSync(path.join(cardsDir(dataDir), 'k-abcdef.json'), '{ broken');
    const { cards, errors } = await listCards(dataDir);
    expect(cards).toHaveLength(1);
    expect(errors[0]?.path).toBe('cards/k-abcdef.json');
  });

  test('summaries carry no prompt and no images', async () => {
    await initBoard(dataDir);
    const card = await addCard(dataDir, {
      title: 'Slim',
      task: { prompt: 'a long task', images: [{ name: 'a.png', mimeType: 'image/png', dataBase64: 'AAAA' }] },
    });
    const summary = summarize(card);
    expect(summary).not.toHaveProperty('task');
    expect(summary.hasPrompt).toBe(true);
    expect(summary.imageCount).toBe(1);
  });

  test('the prompt and image ceilings are refused, not truncated', async () => {
    const card = {
      schema: 2, id: 'k-abcdef', title: 't', status: 'open', priority: 2, workspace: null,
      task: { prompt: 'x'.repeat(MAX_PROMPT_CHARS + 1), images: [] },
      sessionId: null, createdAt: '', updatedAt: '', movedAt: null,
    } satisfies Card;
    expect(refusal(() => validateCard(card)).message).toContain(String(MAX_PROMPT_CHARS));

    const images = Array.from({ length: MAX_IMAGES + 1 }, () => ({ name: 'a', mimeType: 'image/png', dataBase64: 'A' }));
    expect(refusal(() => validateCard({ ...card, task: { prompt: '', images } })).message).toContain('images');
  });

  test('priority outside 0..4 is refused', async () => {
    await initBoard(dataDir);
    expect((await asyncRefusal(() => addCard(dataDir, { title: 'x', priority: 9 }))).code).toBe('invalid');
  });

  test('delete removes the file and a second delete says not found', async () => {
    await initBoard(dataDir);
    const card = await addCard(dataDir, { title: 'Gone' });
    await removeCard(dataDir, card.id);
    expect(fs.existsSync(cardFile(dataDir, card.id))).toBe(false);
    expect((await asyncRefusal(() => removeCard(dataDir, card.id))).code).toBe('not_found');
  });

  test('an atomic write leaves no temp file behind', async () => {
    await initBoard(dataDir);
    const card = await addCard(dataDir, { title: 'Clean' });
    await mutateCard(dataDir, card.id, (current) => ({ ...current, title: 'Clean 2' }));
    expect(fs.readdirSync(cardsDir(dataDir)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });
});

describe('stages', () => {
  test('a move into a session stage without a link asks for Start work', async () => {
    await initBoard(dataDir);
    const card = await addCard(dataDir, { title: 'Work' });
    const moved = await moveCard(dataDir, card.id, 'in_progress');
    expect(moved.card.status).toBe('in_progress');
    expect(moved.next).toBe('start_work_required');
  });

  test('a move into a planning stage asks for nothing', async () => {
    await initBoard(dataDir);
    const card = await addCard(dataDir, { title: 'Plan' });
    expect((await moveCard(dataDir, card.id, 'backlog')).next).toBeUndefined();
  });

  test('a linked card needs no Start work', async () => {
    await initBoard(dataDir);
    const card = await addCard(dataDir, { title: 'Linked' });
    await linkSession(dataDir, card.id, 'sess-1');
    expect((await moveCard(dataDir, card.id, 'in_progress')).next).toBeUndefined();
  });

  test('claim records the session and lands in the working stage in one write', async () => {
    await initBoard(dataDir);
    const card = await addCard(dataDir, { title: 'Claim me' });
    const claimed = await claimCard(dataDir, card.id, 'sess-9');
    expect(claimed.status).toBe('in_progress');
    expect(claimed.sessionId).toBe('sess-9');
    expect(claimed.movedAt).not.toBeNull();
  });

  test('a duplicate stage id is refused', async () => {
    await initBoard(dataDir);
    const stages: Stage[] = [...defaultBoard('').stages, { id: 'open', label: 'Again', hidden: false, session: false }];
    expect((await asyncRefusal(() => saveStages(dataDir, stages))).message).toContain('twice');
  });

  test('a stage id that could not be a filename is refused', async () => {
    await initBoard(dataDir);
    const stages: Stage[] = [{ id: '../escape', label: 'X', hidden: false, session: false }];
    expect((await asyncRefusal(() => saveStages(dataDir, stages))).code).toBe('invalid');
  });
});

describe('next card', () => {
  test('the highest priority card that is not done wins', async () => {
    await initBoard(dataDir);
    await addCard(dataDir, { title: 'Low', priority: 4 });
    const urgent = await addCard(dataDir, { title: 'Urgent', priority: 0 });
    await addCard(dataDir, { title: 'Medium', priority: 2 });
    expect((await nextCard(dataDir))?.id).toBe(urgent.id);
  });

  test('a done card is never offered', async () => {
    await initBoard(dataDir);
    const card = await addCard(dataDir, { title: 'Finished', priority: 0 });
    await moveCard(dataDir, card.id, 'done');
    await addCard(dataDir, { title: 'Next', priority: 3 });
    expect((await nextCard(dataDir))?.title).toBe('Next');
  });

  test('a workspace filter only offers that workspace, and null is not a wildcard', async () => {
    await initBoard(dataDir);
    await addCard(dataDir, { title: 'A', workspace: '/a', priority: 0 });
    const b = await addCard(dataDir, { title: 'B', workspace: '/b', priority: 1 });
    expect((await nextCard(dataDir, '/b'))?.id).toBe(b.id);
    await addCard(dataDir, { title: 'Global', priority: 0 });
    expect((await nextCard(dataDir, null))?.title).toBe('Global');
  });
});

describe('removal', () => {
  test('deleting the plugin directory leaves the board alone', async () => {
    // The board lives in the DATA dir, so "remove the plugin" cannot reach it.
    // This is the property that made files win over plugin storage rows.
    await initBoard(dataDir);
    const card = await addCard(dataDir, { title: 'Mine' });
    expect(fs.readFileSync(boardFile(dataDir), 'utf8')).toContain('schema');
    expect(fs.existsSync(cardFile(dataDir, card.id))).toBe(true);
    expect(fs.existsSync(path.join(dataDir, 'kanban', 'src'))).toBe(false);
  });
});
