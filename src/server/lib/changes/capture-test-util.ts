/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Shared fixtures for the capture tests: a fake filesystem and a journal reader.
 *
 * The fake filesystem is a `Map`, so the before/after pair is deterministic:
 * `flush()` after the start frame proves the snapshot ran before the test
 * changes the file.
 */

import { ChangeCapture } from '@/server/lib/changes/capture.server';
import { ChangeJournal } from '@/server/lib/changes/journal.server';
import { journalPath } from '@/server/lib/changes/paths.server';
import { parseJournalLine, type JournalRecord } from '@/server/lib/changes/records';

export function makeCapture(
  sessionId: string,
  files: Map<string, string>,
  extra: Partial<ConstructorParameters<typeof ChangeCapture>[0]> = {},
): ChangeCapture {
  const journal = new ChangeJournal(sessionId, '/repo');
  return new ChangeCapture({
    journal,
    cwd: '/repo',
    home: '/home/u',
    readFile: async (absolute) => files.get(absolute) ?? null,
    statFile: async (absolute) => (files.has(absolute) ? { mtimeMs: 1, size: files.get(absolute)?.length ?? 0 } : null),
    ...extra,
  });
}

export async function records(sessionId: string): Promise<JournalRecord[]> {
  const text = await Bun.file(journalPath(sessionId)).text();
  return text.split('\n').map(parseJournalLine).filter((line): line is JournalRecord => line !== null);
}
