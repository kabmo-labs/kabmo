/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One card file: parse it, summarise it, write it back without losing fields.
 *
 * Split from `board.ts` because the two halves have different failure modes. A
 * board is a single document with stages; a card is a row that ANOTHER PROCESS
 * (the MCP child, or an agent with a text editor) also writes. So this file owns
 * the concurrency token (`updatedAt`, bumped strictly forward), the write lock,
 * and the rule that an unknown field survives.
 */

import fs from 'fs';
import path from 'path';

import {
  CARD_ID,
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  MAX_PROMPT_CHARS,
  STAGE_ID,
  type BoardError,
  type Card,
  type CardSummary,
} from '../protocol';
import {
  KanbanError,
  cardFile,
  cardsDir,
  exists,
  messageOf,
  readJson,
  withWriteLock,
  writeJsonAtomic,
} from './fs';
import { asRecord, asString } from './board';

/** Every card file, as a summary, plus the files that could not be read. */
export async function listCards(dataDir: string): Promise<{ cards: CardSummary[]; errors: BoardError[] }> {
  const dir = cardsDir(dataDir);
  let names: string[];
  try {
    names = await fs.promises.readdir(dir);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return { cards: [], errors: [] };
    throw new KanbanError('io', `Could not list ${dir}: ${messageOf(cause)}`);
  }
  const cards: CardSummary[] = [];
  const errors: BoardError[] = [];
  for (const name of names.filter((entry) => entry.endsWith('.json') && !entry.startsWith('.')).sort()) {
    const file = path.join(dir, name);
    try {
      const card = parseCard(await readJson(file), name.slice(0, -'.json'.length));
      cards.push(summarize(card));
    } catch (cause) {
      // A file an agent broke is REPORTED with its path, never skipped: a board
      // that silently drops a card is worse than one that says which is bad.
      errors.push({ path: path.join('cards', name), message: messageOf(cause) });
    }
  }
  return { cards, errors };
}

/** The card without its prose, which is all a board view draws. */
export function summarize(card: Card): CardSummary {
  const { task, ...rest } = card;
  return { ...rest, hasPrompt: task.prompt.length > 0, imageCount: task.images.length };
}

/** Validate one parsed card file. Throws with the sentence the panel shows. */
export function parseCard(raw: unknown, idFromName: string): Card {
  const record = asRecord(raw);
  const id = asString(record.id) || idFromName;
  if (!CARD_ID.test(id)) throw new KanbanError('invalid', `Card id "${id}" is not a k-xxxxxx id.`);
  const task = asRecord(record.task);
  const images = Array.isArray(task.images)
    ? task.images.filter((entry): entry is { name: string; mimeType: string; dataBase64: string } => {
        const image = asRecord(entry);
        return typeof image.dataBase64 === 'string';
      }).map((entry) => ({
        name: asString(asRecord(entry).name) || 'image',
        mimeType: asString(asRecord(entry).mimeType) || 'image/png',
        dataBase64: asString(asRecord(entry).dataBase64),
      }))
    : [];
  return {
    schema: 2,
    id,
    title: asString(record.title) || '(untitled)',
    status: asString(record.status) || 'open',
    priority: typeof record.priority === 'number' ? record.priority : 2,
    workspace: typeof record.workspace === 'string' && record.workspace ? record.workspace : null,
    task: {
      prompt: asString(task.prompt),
      images,
      ...(task.agent !== undefined ? { agent: asRecord(task.agent) as Card['task']['agent'] } : {}),
    },
    sessionId: asString(record.sessionId) || null,
    createdAt: asString(record.createdAt) || new Date().toISOString(),
    updatedAt: asString(record.updatedAt) || new Date().toISOString(),
    movedAt: asString(record.movedAt) || null,
  };
}

/** One card, with the raw record so a write can preserve unknown fields. */
export async function readCard(dataDir: string, id: string): Promise<{ card: Card; raw: Record<string, unknown> }> {
  if (!CARD_ID.test(id)) throw new KanbanError('invalid', `"${id}" is not a card id.`);
  const file = cardFile(dataDir, id);
  const parsed = await readJson(file).catch((cause: unknown) => {
    throw new KanbanError('io', `Could not read ${file}: ${messageOf(cause)}`);
  });
  if (parsed === null) throw new KanbanError('not_found', `No card "${id}".`);
  return { card: parseCard(parsed, id), raw: asRecord(parsed) };
}

/**
 * A stamp strictly after `previous`.
 *
 * Two writes can land inside one millisecond, and `baseUpdatedAt` compares
 * strings — so an unchanged `updatedAt` would let the second write through as if
 * the first never happened. Bumping by a millisecond keeps the field a usable
 * concurrency token without a separate counter.
 */
function nextStamp(previous: string): string {
  const now = Date.now();
  const last = Date.parse(previous);
  return new Date(Number.isFinite(last) && last >= now ? last + 1 : now).toISOString();
}

/** Write one card, preserving every field the caller did not touch. */
export async function writeCard(dataDir: string, card: Card, raw: Record<string, unknown>): Promise<Card> {
  validateCard(card);
  const next: Card = { ...card, updatedAt: nextStamp(card.updatedAt) };
  await writeJsonAtomic(cardFile(dataDir, next.id), { ...raw, ...next, task: next.task });
  return next;
}

/** The rules a write must satisfy, each refused by name. */
export function validateCard(card: Card): void {
  if (!CARD_ID.test(card.id)) throw new KanbanError('invalid', `"${card.id}" is not a card id.`);
  if (!card.title.trim()) throw new KanbanError('invalid', 'A card needs a title.');
  if (!STAGE_ID.test(card.status)) throw new KanbanError('invalid', `"${card.status}" is not a stage id.`);
  if (!Number.isInteger(card.priority) || card.priority < 0 || card.priority > 4) {
    throw new KanbanError('invalid', 'Priority is 0..4 (P0 urgent … P4 backlog).');
  }
  if (card.task.prompt.length > MAX_PROMPT_CHARS) {
    throw new KanbanError('invalid', `A prompt is limited to ${MAX_PROMPT_CHARS} characters.`);
  }
  if (card.task.images.length > MAX_IMAGES) {
    throw new KanbanError('invalid', `A card holds at most ${MAX_IMAGES} images.`);
  }
  const bytes = card.task.images.reduce((sum, image) => sum + image.dataBase64.length, 0);
  if (bytes > MAX_IMAGE_BYTES * 1.4) {
    // base64 is ~1.37x the decoded size; the cap is stated in decoded bytes.
    throw new KanbanError('invalid', 'A card’s images exceed 2 MB.');
  }
}

/** A card id nobody holds, checked against the directory. */
async function freshId(dataDir: string): Promise<string> {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const id = `k-${Bun.randomUUIDv7().replace(/-/g, '').slice(-6)}`;
    if (!(await exists(cardFile(dataDir, id)))) return id;
  }
  throw new KanbanError('io', 'Could not allocate a card id.');
}

/** Create one card. The caller supplies everything but the id and the stamps. */
export async function createCard(
  dataDir: string,
  input: { title: string; status?: string; workspace?: string | null; task?: Partial<Card['task']>; priority?: number },
): Promise<Card> {
  return withWriteLock(dataDir, async () => {
    const now = new Date().toISOString();
    const card: Card = {
      schema: 2,
      id: await freshId(dataDir),
      title: input.title,
      status: input.status ?? 'open',
      priority: input.priority ?? 2,
      workspace: input.workspace ?? null,
      task: { prompt: input.task?.prompt ?? '', images: input.task?.images ?? [], ...(input.task?.agent ? { agent: input.task.agent } : {}) },
      sessionId: null,
      createdAt: now,
      updatedAt: now,
      movedAt: null,
    };
    validateCard(card);
    await writeJsonAtomic(cardFile(dataDir, card.id), card);
    return card;
  });
}

/** Delete one card file. */
export async function deleteCard(dataDir: string, id: string): Promise<void> {
  if (!CARD_ID.test(id)) throw new KanbanError('invalid', `"${id}" is not a card id.`);
  await withWriteLock(dataDir, async () => {
    try {
      await fs.promises.rm(cardFile(dataDir, id));
    } catch (cause) {
      throw new KanbanError('not_found', `No card "${id}" (${messageOf(cause)}).`);
    }
  });
}

/** Apply a change under the lock, re-reading first so an agent's edit is not lost. */
export async function mutateCard(
  dataDir: string,
  id: string,
  change: (card: Card, raw: Record<string, unknown>) => Card | Promise<Card>,
  options: { baseUpdatedAt?: string } = {},
): Promise<Card> {
  return withWriteLock(dataDir, async () => {
    const { card, raw } = await readCard(dataDir, id);
    if (options.baseUpdatedAt && options.baseUpdatedAt !== card.updatedAt) {
      throw new KanbanError('stale', 'This card changed on disk — reload it before saving.');
    }
    return writeCard(dataDir, await change(card, raw), raw);
  });
}
