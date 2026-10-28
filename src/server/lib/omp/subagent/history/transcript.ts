/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Byte-window transcript paging for on-disk subagent histories.
 *
 * The child transcript is a plain omp session JSONL (`<parent>/<id>.jsonl`);
 * pages are read positionally from `fromByte` so a pagination walk is O(n) in
 * I/O and a page never materializes more than `maxBytes`. Entries are returned
 * raw — the client converts them to chat messages, so message bodies are never
 * parsed server-side beyond splitting complete JSONL lines.
 *
 * Mirrors omp-web/lib/subagent-history.ts readSubagentTranscriptPage, with the
 * child path resolved from the parent session file + subagent id.
 */

import { promises as fsp } from 'fs';
import { dirname, join } from 'path';
import { parseJsonlLenient } from '@/shared/lib/omp/session/jsonl';
import { SUBAGENT_ID_MAX_LENGTH, SUBAGENT_ID_RE, siblingDirForSession } from '@/server/lib/omp/subagent/history/paths';
import type { SubagentMessagesPage } from '@/shared/types/omp/subagent';

/** Bytes read per page call — bounds each response window. */
export const SUBAGENT_TRANSCRIPT_PAGE_BYTES = 256 * 1024;

/**
 * Resolve a subagent transcript inside the parent session's sibling artifacts
 * dir, with symlink confinement: the candidate's REAL path must land directly
 * inside the REAL artifacts dir and be a regular file. The id grammar is
 * validated by the caller, so no traversal form can reach the join.
 */
async function resolveTranscriptPath(sessionFilePath: string, subagentId: string): Promise<string | null> {
  let realDir: string;
  try {
    realDir = await fsp.realpath(siblingDirForSession(sessionFilePath));
  } catch {
    return null;
  }
  const candidate = join(realDir, `${subagentId}.jsonl`);
  let realCandidate: string;
  try {
    realCandidate = await fsp.realpath(candidate);
  } catch {
    return null;
  }
  if (dirname(realCandidate) !== realDir) return null;
  try {
    if (!(await Bun.file(realCandidate).stat()).isFile()) return null;
  } catch {
    return null;
  }
  return realCandidate;
}

/**
 * Read a byte window of a subagent transcript starting at `fromByte`.
 * Returns null when the parent has no sibling dir or the child transcript is
 * missing. `reset` is set when `fromByte` sits past the file end (retruncated
 * transcript) — the caller must restart paging from the returned fromByte.
 */
export async function readSubagentTranscriptPage(
  sessionFilePath: string,
  subagentId: string,
  fromByte = 0,
  maxBytes: number = SUBAGENT_TRANSCRIPT_PAGE_BYTES,
): Promise<SubagentMessagesPage | null> {
  if (!SUBAGENT_ID_RE.test(subagentId) || subagentId.length > SUBAGENT_ID_MAX_LENGTH) return null;
  const transcriptPath = await resolveTranscriptPath(sessionFilePath, subagentId);
  if (!transcriptPath) return null;

  let size: number;
  try {
    size = (await Bun.file(transcriptPath).stat()).size;
  } catch {
    return null;
  }

  const requested = typeof fromByte === 'number' && Number.isFinite(fromByte)
    ? Math.max(0, Math.trunc(fromByte))
    : 0;
  const reset = requested > size;
  const startByte = reset ? 0 : requested;
  const pageBytes = Number.isFinite(maxBytes) && maxBytes > 0
    ? Math.trunc(maxBytes)
    : SUBAGENT_TRANSCRIPT_PAGE_BYTES;
  const endByte = Math.min(size, startByte + pageBytes);

  let body = '';
  try {
    // Slice by BYTE offsets, not string indices: startByte is a UTF-8 offset
    // while string indices are UTF-16 code units — slicing the decoded string
    // would misalign every later page once non-ASCII text precedes the offset.
    const windowBytes = endByte - startByte;
    if (windowBytes > 0) {
      body = await Bun.file(transcriptPath).slice(startByte, endByte).text();
    }
  } catch {
    return {
      sessionFile: transcriptPath,
      fromByte: startByte,
      nextByte: startByte,
      reset,
      messages: [],
      totalBytes: size,
    };
  }

  // JSON.stringify never emits raw newlines, so only complete lines are safe to
  // deliver — a torn tail line is left for the next page.
  const lastNewline = body.lastIndexOf('\n');
  const completeText = lastNewline >= 0 ? body.slice(0, lastNewline + 1) : '';
  const messages = completeText.length > 0 ? parseJsonlLenient<unknown>(completeText) : [];
  let nextByte = startByte + Buffer.byteLength(completeText, 'utf8');
  // Guarantee forward progress: when the window ends mid-line and more content
  // remains, the partial line has no newline to complete it — skip it instead
  // of returning the same offset forever.
  if (nextByte === startByte && endByte < size) nextByte = endByte;

  return { sessionFile: transcriptPath, fromByte: startByte, nextByte, reset, messages, totalBytes: size };
}
