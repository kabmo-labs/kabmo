/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The small pieces of omp transcript surgery shared by two features.
 *
 * BTW promotion turns a side-question transcript into a chat; a fork turns a
 * chat into a branch. Both need the same three primitives — read whole lines
 * without a torn tail, find the leaf, and rewrite the title/header pair under a
 * new id — and a second copy of them is how the two drift.
 *
 * The file layout they rely on (verified against omp files): line 1 is a
 * fixed-width title slot, line 2 is the `session` header carrying `id`, `cwd`
 * and `parentSession`, and the rest are entries.
 */

import { serializeTitleSlot } from '@/server/lib/omp/session/title-slot';

export function parseJsonObject(line: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(line);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * The file's lines, minus a torn tail.
 *
 * A snapshot taken while the writer is mid-append can end in a partial line;
 * keeping it would make a resumed child fail to load the transcript.
 */
export function completeLines(text: string): string[] {
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

/** The title slot line, padded to the fixed slot omp rewrites in place, with
 *  the trailing newline removed (callers join the lines themselves). */
export function buildTitleLine(title: string, source: string, updatedAt: string): string {
  const line = serializeTitleSlot({
    title,
    source: source === 'auto' ? 'auto' : 'user',
    updatedAt,
  });
  return line.endsWith('\n') ? line.slice(0, -1) : line;
}

/** The chat's own title, from the title slot or the header. */
export function transcriptTitle(lines: string[]): string {
  for (const line of lines) {
    const record = parseJsonObject(line);
    if (!record) continue;
    if (record.type === 'title' && typeof record.title === 'string') return record.title;
    if (record.type === 'session' && typeof record.title === 'string') return record.title;
    if (record.type === 'session') return '';
  }
  return '';
}

export interface BranchTranscriptInput {
  lines: string[];
  newId: string;
  timestamp: string;
  title: string;
  /** Absolute path of the file the branch came from, as omp records it. */
  parentSessionFile: string;
}

/**
 * Rewrite a source transcript as a branch under a new identity.
 *
 * The title slot moves to line 1 (dropping the source's slot), and the header
 * gets the new id, the new timestamp, the branch title and the source path.
 * Every other record is copied verbatim — including model/thinking changes,
 * which are what make the resumed child continue with the same selections.
 */
export function branchTranscript(input: BranchTranscriptInput): string {
  const body: string[] = [];
  let titleDropped = false;
  let headerWritten = false;
  for (const line of input.lines) {
    const record = parseJsonObject(line);
    if (record?.type === 'title' && !titleDropped) {
      titleDropped = true;
      continue;
    }
    if (record?.type === 'session' && !headerWritten) {
      headerWritten = true;
      body.push(
        JSON.stringify({
          ...record,
          id: input.newId,
          timestamp: input.timestamp,
          title: input.title,
          titleSource: 'user',
          parentSession: input.parentSessionFile,
        }),
      );
      continue;
    }
    body.push(line);
  }
  if (!headerWritten) throw new Error('Transcript has no session header');
  return `${[buildTitleLine(input.title, 'user', input.timestamp), ...body].join('\n')}\n`;
}
