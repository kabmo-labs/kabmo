/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Per-topic session workspaces, and promotion of a topic into the chat.
 *
 * A topic's side conversation runs in an omp child that resumes a *copy* of
 * the parent session file. That copy is what makes the side question cheap and
 * honest: the parent's transcript arrives as real provider messages (no
 * re-prompting it as text), the parent file is never written by the side
 * child, and the copy itself becomes the topic's durable history — a follow-up
 * after the child was reclaimed resumes it and still sees every earlier turn.
 *
 * Promotion turns the copy into a session of Kabmo's own: the file is
 * rewritten with a fresh session id and a title taken from the question, then
 * placed beside the parent session — the same end state omp's `/btw` reaches
 * with its branch action, where the side answer becomes the tip of a new
 * conversation that carries the parent's history.
 *
 * Session-file layout details that matter here (all verified against omp
 * 18.2.6 files):
 *  - Line 1 is the title slot: `{"type":"title","v":1,"title":…,"source":…,
 *    "updatedAt":…,"pad":"…"}` padded so the serialized line is exactly
 *    `SESSION_TITLE_SLOT_BYTES` bytes — omp rewrites it in place, and the
 *    serializer in `omp/session/title-slot.ts` owns both the truncation and the
 *    padding arithmetic.
 *  - Line 2 is the session header (`type:"session"`), carrying `id`, `cwd`,
 *    and for a branch `parentSession` — the file it branched from.
 *  - File names are `<ISO with [:. ] → ->_<session id>.jsonl`.
 */

import fs from 'fs';
import * as path from 'path';
import { getDatabasePath } from '@/server/db.server';
import { clearSessionFileCaches } from '@/server/lib/omp/session/files';
import { serializeTitleSlot } from '@/server/lib/omp/session/title-slot';
import { isRecord } from '@/shared/lib/util/guards';

/** Root holding every topic workspace, beside Kabmo database. */
export async function getBtwRoot(): Promise<string> {
  const root = path.join(path.dirname(await getDatabasePath()), 'btw');
  await fs.promises.mkdir(root, { recursive: true });
  return root;
}

function parseJsonObject(line: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(line);
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * The file's lines, minus a torn tail. A snapshot taken while the parent is
 * mid-append can end in a partial line; keeping it would make the side child
 * fail to load the transcript.
 */
function completeLines(text: string): string[] {
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const last = lines[lines.length - 1];
  if (last !== undefined && parseJsonObject(last) === null) lines.pop();
  return lines;
}

/** The transcript's leaf: the id of its last entry. */
export function lastEntryId(lines: string[]): string | null {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const record = parseJsonObject(lines[index]);
    if (record && typeof record.id === 'string') return record.id;
  }
  return null;
}

/** Read a transcript's leaf id straight from disk. */
export async function readTranscriptLeaf(sessionFile: string): Promise<string | null> {
  try {
    return lastEntryId(completeLines(await Bun.file(sessionFile).text()));
  } catch {
    return null;
  }
}

/** The title slot line, padded to the fixed slot omp rewrites in place, with
 *  the trailing newline removed (the writer here joins lines itself).
 *
 *  Delegates to the repo's slot serializer rather than re-deriving the width:
 *  that one truncates the title by code point, so a question written in CJK
 *  (up to 3 UTF-8 bytes each) still fits — clipping by character count alone
 *  would overflow the slot and fail promotion outright. */
export function buildTitleLine(title: string, source: string, updatedAt: string): string {
  const line = serializeTitleSlot({ title, source: source === 'auto' ? 'auto' : 'user', updatedAt });
  return line.endsWith('\n') ? line.slice(0, -1) : line;
}

export interface BtwWorkspace {
  dir: string;
  sessionFile: string;
  /** Parent transcript leaf at snapshot time — the promotion guard's baseline. */
  leafId: string | null;
}

/** Where a topic's transcript lives. Derived, never stored: a topic that lost
 *  its runtime still finds the same file, which is what makes a follow-up
 *  continue the side conversation instead of starting it over. */
export async function resolveBtwWorkspacePaths(sessionId: string, topicId: string): Promise<Omit<BtwWorkspace, 'leafId'>> {
  const dir = path.join(await getBtwRoot(), sessionId, topicId);
  return { dir, sessionFile: path.join(dir, 'session.jsonl') };
}

/** Snapshot the parent transcript into a topic's private session file. */
export async function createBtwWorkspace(input: {
  parentSessionId: string;
  topicId: string;
  parentSessionFile: string;
}): Promise<BtwWorkspace> {
  const dir = path.join(await getBtwRoot(), input.parentSessionId, input.topicId);
  await fs.promises.mkdir(dir, { recursive: true });
  const lines = completeLines(await Bun.file(input.parentSessionFile).text());
  const sessionFile = path.join(dir, 'session.jsonl');
  await Bun.write(sessionFile, lines.length > 0 ? `${lines.join('\n')}\n` : '');
  return { dir, sessionFile, leafId: lastEntryId(lines) };
}

/**
 * The visible question behind a side-question prompt.
 *
 * The side session's own transcript keeps the full `<btw>` template (that is
 * its record, and the shape the side child was resumed with). Promoting lifts
 * the pair into a chat, where the boilerplate would be noise the user never
 * typed — omp's own branch action appends the plain question, and so does this.
 */
function unwrapBtwQuestion(text: string): string {
  if (!text.startsWith('<btw>')) return text;
  const marker = '\nQuestion:\n';
  const start = text.indexOf(marker);
  if (start < 0) return text;
  const end = text.lastIndexOf('</btw>');
  const question = text.slice(start + marker.length, end > start ? end : undefined).trim();
  return question || text;
}

function unwrapBtwPrompts(record: Record<string, unknown>): Record<string, unknown> {
  const message = record.message;
  if (!isRecord(message) || message.role !== 'user' || !Array.isArray(message.content)) return record;
  const content = message.content.map((part) =>
    isRecord(part) && part.type === 'text' && typeof part.text === 'string'
      ? { ...part, text: unwrapBtwQuestion(part.text) }
      : part,
  );
  return { ...record, message: { ...message, content } };
}

/**
 * Promote a topic: write its transcript next to the parent session under a
 * fresh session id, so Kabmo (and omp) treat it as a branch of the
 * parent conversation whose tip is the side answer. Returns the new id.
 */
export async function promoteBtwTopic(input: {
  parentSessionFile: string;
  topicSessionFile: string;
  title: string;
}): Promise<string> {
  const lines = completeLines(await Bun.file(input.topicSessionFile).text());
  const newId = crypto.randomUUID();
  const timestamp = new Date().toISOString();

  let titleDropped = false;
  let headerWritten = false;
  const body: string[] = [];
  for (const line of lines) {
    const record = parseJsonObject(line);
    if (record?.type === 'title' && !titleDropped) {
      // The slot moves to line 1 below; a later title record is left alone.
      titleDropped = true;
      continue;
    }
    if (record?.type === 'session' && !headerWritten) {
      headerWritten = true;
      body.push(
        JSON.stringify({
          ...record,
          id: newId,
          timestamp,
          title: input.title,
          titleSource: 'user',
          parentSession: input.parentSessionFile,
        }),
      );
      continue;
    }
    body.push(record?.type === 'message' ? JSON.stringify(unwrapBtwPrompts(record)) : line);
  }
  if (!headerWritten) throw new Error('BTW topic transcript has no session header');

  const fileName = `${timestamp.replace(/[:.]/g, '-')}_${newId}.jsonl`;
  const target = path.join(path.dirname(input.parentSessionFile), fileName);
  // An existing file at this name would mean the id collided; never truncate.
  if (await Bun.file(target).exists()) throw new Error(`Promoted session file already exists: ${fileName}`);
  await Bun.write(target, `${[buildTitleLine(input.title, 'user', timestamp), ...body].join('\n')}\n`);
  // The sidebar list and the id→path scan are mtime-keyed caches.
  clearSessionFileCaches();
  return newId;
}

/** Drop a topic's workspace (its transcript lives in the database after this). */
export async function removeBtwWorkspace(dir: string): Promise<void> {
  await fs.promises.rm(dir, { recursive: true, force: true });
}
