/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The board's files, and the two primitives every write goes through.
 *
 * The board lives OUTSIDE every checkout (`<dataDir>/kanban`), because it is one
 * queue for the person rather than an artifact of a repository: a per-repo board
 * dies with its clone, and "what am I working on" then needs a tool to answer.
 *
 * Two writers exist — Kabmo's process (the panel's RPC) and the MCP child (a
 * separate Bun process an agent talks to). `rename` keeps a reader from seeing a
 * torn file but does not stop a lost update, so every read-modify-write takes
 * `cards/.write.lock`. That is the whole concurrency story and it is deliberate:
 * a database would be a second store, and the point of files is that an agent
 * with nothing but its file tools can read them.
 */

import fs from 'fs';
import path from 'path';

import type { KanbanErrorCode } from '../protocol';

/** A refusal the panel and the MCP tools both surface verbatim. */
export class KanbanError extends Error {
  readonly code: KanbanErrorCode;

  constructor(code: KanbanErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'KanbanError';
  }
}

/** The board root for a host data dir. */
export function boardDir(dataDir: string): string {
  return path.join(dataDir, 'kanban');
}

export function cardsDir(dataDir: string): string {
  return path.join(boardDir(dataDir), 'cards');
}

export function boardFile(dataDir: string): string {
  return path.join(boardDir(dataDir), 'board.json');
}

/** Whether a board exists, without parsing it. */
export async function hasBoard(dataDir: string): Promise<boolean> {
  return exists(boardFile(dataDir));
}

export function cardFile(dataDir: string, id: string): string {
  return path.join(cardsDir(dataDir), `${id}.json`);
}

/** `<dir>/.write.lock` — held across one read-modify-write. */
function lockFile(dataDir: string): string {
  return path.join(cardsDir(dataDir), '.write.lock');
}

const LOCK_ATTEMPTS = 20;
const LOCK_RETRY_MS = 5;
const LOCK_STALE_MS = 5_000;

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/**
 * Run `work` while holding the board's write lock.
 *
 * A lock left behind by a process that died is taken over after
 * `LOCK_STALE_MS`; without that, one crash would freeze every future write.
 */
export async function withWriteLock<T>(dataDir: string, work: () => Promise<T>): Promise<T> {
  await fs.promises.mkdir(cardsDir(dataDir), { recursive: true });
  const file = lockFile(dataDir);
  let handle: fs.promises.FileHandle | null = null;
  for (let attempt = 0; attempt < LOCK_ATTEMPTS && !handle; attempt += 1) {
    try {
      handle = await fs.promises.open(file, 'wx');
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause;
      const age = await lockAge(file);
      if (age !== null && age > LOCK_STALE_MS) {
        await fs.promises.rm(file, { force: true });
        continue;
      }
      await sleep(LOCK_RETRY_MS);
    }
  }
  if (!handle) {
    throw new KanbanError('io', 'The board is busy: another writer holds cards/.write.lock.');
  }
  try {
    return await work();
  } finally {
    await handle.close().catch(() => undefined);
    await fs.promises.rm(file, { force: true }).catch(() => undefined);
  }
}

async function lockAge(file: string): Promise<number | null> {
  try {
    const stat = await fs.promises.stat(file);
    return Date.now() - stat.mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Write JSON through a sibling temp file and a rename.
 *
 * Same directory, so the rename cannot cross a mount and is atomic; the temp
 * name is unique per write so two writers cannot clobber each other's file even
 * if the lock is somehow skipped.
 */
export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  const dir = path.dirname(file);
  await fs.promises.mkdir(dir, { recursive: true });
  const temp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  await fs.promises.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  try {
    await fs.promises.rename(temp, file);
  } catch (cause) {
    await fs.promises.rm(temp, { force: true }).catch(() => undefined);
    throw new KanbanError('io', `Could not write ${file}: ${messageOf(cause)}`);
  }
}

export function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Read and parse one JSON file, or null when it does not exist. */
export async function readJson(file: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.promises.readFile(file, 'utf8')) as unknown;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw cause;
  }
}

/** Whether a path exists (a directory or a file). */
export async function exists(file: string): Promise<boolean> {
  try {
    await fs.promises.stat(file);
    return true;
  } catch {
    return false;
  }
}
