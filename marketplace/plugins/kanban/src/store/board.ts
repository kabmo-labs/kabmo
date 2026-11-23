/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Reading and writing the board: one `board.json` and one file per card.
 *
 * A card file is the unit of change — one card edited is one file written, and a
 * reader never has to parse a list that carries every card's prompt. `listCards`
 * therefore returns SUMMARIES: the panel does not need a prompt to draw a card,
 * and a 500-card board over a socket should not carry 500 prompts.
 *
 * `readCard` keeps the raw record beside the typed view so a write can spread it
 * back: a field a newer writer added survives an older panel's edit, which is
 * what keeps two halves of the plugin (and an agent with a text editor) from
 * silently deleting each other's data.
 */

import fs from 'fs';
import path from 'path';

import { DEFAULT_STAGES, STAGE_ID, type Board, type Card, type Stage } from '../protocol';
import { KanbanError, boardDir, boardFile, messageOf, readJson, withWriteLock, writeJsonAtomic } from './fs';

/** A fresh board: the six stages and NO overrides, so every field falls back to the host. */
export function defaultBoard(now: string): Board {
  return {
    schema: 2,
    // Deliberately empty: naming `omp-rpc` here would freeze a copy of the
    // host's default in a file, and the board would then disagree with the
    // composer the day the host changed its mind.
    defaults: {},
    stages: DEFAULT_STAGES.map((stage) => ({ ...stage })),
    updatedAt: now,
  };
}

/** A JSON object, or `{}` for anything else — the shape every reader folds over. */
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

/** One stage off disk, refused when its id could not be a filename. */
function parseStage(raw: unknown): Stage | null {
  const record = asRecord(raw);
  const id = asString(record.id);
  if (!STAGE_ID.test(id)) return null;
  return {
    id,
    label: asString(record.label) || id,
    hidden: record.hidden === true,
    session: record.session === true,
    ...(record.agent !== undefined ? { agent: asRecord(record.agent) as Stage['agent'] } : {}),
  };
}

/**
 * `board.json` as the rest of the plugin uses it, or a `no_board` refusal.
 *
 * An unreadable file is NOT an empty board: reporting "no cards" over a file
 * that failed to parse is how a board silently looks wiped.
 */
export async function readBoard(dataDir: string): Promise<Board> {
  const file = boardFile(dataDir);
  let parsed: unknown;
  try {
    parsed = await readJson(file);
  } catch (cause) {
    throw new KanbanError('io', `Could not read ${file}: ${messageOf(cause)}`);
  }
  if (parsed === null) throw new KanbanError('no_board', 'No board in this data directory yet.');
  const record = asRecord(parsed);
  const stages = (Array.isArray(record.stages) ? record.stages : [])
    .map(parseStage)
    .filter((stage): stage is Stage => stage !== null);
  return {
    schema: 2,
    defaults: asRecord(record.defaults) as Board['defaults'],
    stages: stages.length > 0 ? stages : defaultBoard(new Date().toISOString()).stages,
    updatedAt: asString(record.updatedAt) || new Date().toISOString(),
  };
}

/** Create the board directory, `board.json` and the agent-facing README. */
export async function initBoard(dataDir: string): Promise<Board> {
  const board = defaultBoard(new Date().toISOString());
  await withWriteLock(dataDir, async () => {
    await writeJsonAtomic(boardFile(dataDir), board);
    await fs.promises.writeFile(path.join(boardDir(dataDir), 'README.md'), boardReadme(dataDir), 'utf8');
  });
  return board;
}

/** Write the board back (stages, defaults). Callers hold the lock. */
export async function writeBoard(dataDir: string, board: Board): Promise<void> {
  await writeJsonAtomic(boardFile(dataDir), { ...board, updatedAt: new Date().toISOString() });
}

/** The README an agent reads: it names the absolute path, which is not guessable. */
function boardReadme(dataDir: string): string {
  const root = boardDir(dataDir);
  return `# Kanban

This directory is a task board. One card is one JSON file; the board's stages and
defaults live in \`board.json\`.

- Cards: \`${root}/cards/<id>.json\`
- Stages: \`${root}/board.json\` → \`stages[]\`
- Absolute path: \`${root}\`

## Editing a card

Read the file, change ONLY the fields you mean to change, write it back. Preserve
every field you do not understand — a newer writer may have added one.

- \`status\` must be a stage id from \`board.json\`.
- Bump \`updatedAt\` (ISO 8601) and set \`movedAt\` when you change \`status\`.
- Never write a partial file: write a sibling temp file and rename it over the
  target. Never edit \`board.json\` to move a card.

Prefer the \`kanban_*\` MCP tools when they are available: they take the write
lock and validate the stage for you.
`;
}

/** The parsers the card module reuses, so both files read one set of rules. */
export { asRecord, asString, asStringArray };

/** Stages by id, for the callers that resolve a card's stage. */
export function stageOf(board: Board, id: string): Stage | undefined {
  return board.stages.find((stage) => stage.id === id);
}

/** The stage a card belongs to for display: its own, or undefined when orphaned. */
export function cardStage(board: Board, card: Card): Stage | undefined {
  return stageOf(board, card.status);
}

