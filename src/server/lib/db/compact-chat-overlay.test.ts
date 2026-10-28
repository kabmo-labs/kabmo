/**
 * @license
 * SPDX-License-Identifier: MIT
 *
 * The overlay repair. Its whole risk is asymmetric: narrowing a row it should
 * not touch DESTROYS a conversation (for a chamber-created session the DB is the
 * only copy there is), while leaving a row it should narrow merely wastes disk.
 * So the file-existence gate is the behaviour under test, and it is exercised
 * against a real temp tree rather than a stub — `findSessionFileById` is the
 * thing being trusted.
 *
 * The pass has no marker on purpose (see the module): the per-row "did the
 * filter shrink it?" guard is what makes it self-limiting, so a second run must
 * find nothing left to do.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb, type DbClient } from '@/server/lib/db/client';
import { removeDir } from '@/test-support/remove-dir';
import { initSchema } from '@/server/lib/db/schema';
import { compactChatOverlayRows } from '@/server/lib/db/compact-chat-overlay';

const WITH_FILE = '01a0dddd-1111-7222-8333-444455556666';
const CHAMBER_ONLY = 'new-1700000000000';
const NOTICE = 'Context window: 1000000 tokens (1% used)';

/** Mirrored shape: the user turn plus assistant rows no reader ever touches. */
const MIRRORED = [
  { id: 'msg-1-user', role: 'user', content: 'hello' },
  { id: 'omp-a1', role: 'ai', content: 'hi there' },
  { id: 'cmdout-1', role: 'ai', content: '', notice: NOTICE },
  { id: 'omp-a2', role: 'ai', content: 'more' },
];
/** A chamber-created conversation: no session file exists for it. */
const CHAMBER = [
  { id: 'msg-9-user', role: 'user', content: 'ask' },
  { id: 'local-ai', role: 'ai', content: 'answer' },
];

/** Every connection this file opened, closed before its tree is deleted. */
const opened: DbClient[] = [];
const cleanup: string[] = [];
afterAll(() => {
  // Close, then delete: an open SQLite handle makes a Windows delete fail with
  // EBUSY, and a throw from `afterAll` reports a failure of the file.
  for (const db of opened.splice(0)) db.raw.close();
  for (const target of cleanup) removeDir(target);
});

function tempDir(label: string): string {
  const dir = join(tmpdir(), `overlay-${label}-${crypto.randomUUID()}`);
  cleanup.push(dir);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** A sessions root holding exactly one session file, named the way omp names it. */
function sessionsRoot(): string {
  const root = tempDir('root');
  const project = join(root, '--proj--');
  mkdirSync(project, { recursive: true });
  writeFileSync(
    join(project, `2026-01-01T00-00-00-000Z_${WITH_FILE}.jsonl`),
    `${JSON.stringify({ type: 'session', id: WITH_FILE, timestamp: '2026-01-01T00:00:00.000Z', cwd: '/' })}\n`,
  );
  return root;
}

async function seededDb() {
  const db = createDb(join(tempDir('db'), 'db.sqlite'));
  opened.push(db);
  await initSchema(db);
  const put = (sessionId: string, messages: unknown[]) =>
    db.run('INSERT OR REPLACE INTO chat_sessions (session_id, title, messages) VALUES (?, ?, ?)', [
      sessionId,
      't',
      JSON.stringify(messages),
    ]);
  await put(WITH_FILE, MIRRORED);
  await put(CHAMBER_ONLY, CHAMBER);
  return db;
}

async function storedMessages(db: DbClient, sessionId: string) {
  const row = (await db.get('SELECT messages FROM chat_sessions WHERE session_id = ?', [sessionId])) as {
    messages: string;
  };
  return JSON.parse(row.messages) as { id: string; role: string }[];
}

describe('compactChatOverlayRows', () => {
  test('narrows a mirrored row whose session file exists', async () => {
    const db = await seededDb();
    await compactChatOverlayRows(db, sessionsRoot());

    const kept = await storedMessages(db, WITH_FILE);
    expect(kept.map((m) => m.id)).toEqual(['msg-1-user', 'cmdout-1']);
  });

  test('leaves a chamber-created row untouched — the DB is its only copy', async () => {
    const db = await seededDb();
    await compactChatOverlayRows(db, sessionsRoot());

    expect(await storedMessages(db, CHAMBER_ONLY)).toEqual(CHAMBER);
  });

  test('finds nothing left to do on a second run', async () => {
    const db = await seededDb();
    const root = sessionsRoot();
    await compactChatOverlayRows(db, root);
    const once = JSON.stringify({
      mirrored: await storedMessages(db, WITH_FILE),
      chamber: await storedMessages(db, CHAMBER_ONLY),
    });

    await compactChatOverlayRows(db, root);

    expect(
      JSON.stringify({
        mirrored: await storedMessages(db, WITH_FILE),
        chamber: await storedMessages(db, CHAMBER_ONLY),
      }),
    ).toBe(once);
  });
});
