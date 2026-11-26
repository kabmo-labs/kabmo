/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * omp 19's patch journal: a `change` record stores hunks, not blob keys.
 *
 * omp 18 wrote `before`/`after` as content-addressed blob keys. From 19 on the
 * writer records `{base, gap, edit, sum}` instead:
 *
 *   - `base` — the before content as a blob key; `null` when the file did not
 *     exist. Omitted when the writer's own cache already held the previous
 *     text of this path, which is why a record's before can require its
 *     predecessor.
 *   - `gap` — the step from that cached text to this record's before.
 *   - `edit` — the step from before to after, one `[start, deleteCount, lines]`
 *     hunk each.
 *   - `sum` — `Bun.hash(after)` in base36, or `-` when the file was deleted.
 *
 * A hunk list larger than 4 KB is itself stored as a blob, so `gap` and `edit`
 * are either an inline array or a key. A record with none of the four fields is
 * one omp could not store (over 8 MB, or NUL bytes): unknown, never guessed.
 *
 * The reconstruction follows `snapshots()` in omp's writer, including its
 * checksum gate: a record whose rebuilt after does not hash to `sum` is
 * reported unknown rather than shown as a diff that never existed.
 */

import path from 'node:path';
import { findSessionFileById } from '@kabmo-labs/kabmo-omp/session-locator';
import { siblingDirForSession } from '@kabmo-labs/kabmo-omp/subagent/history-paths';

export interface OmpPatch {
  base?: string | null;
  gap?: unknown;
  edit?: unknown;
  sum?: string;
}

/** The two full texts of one patch record. */
export interface OmpPatchSides {
  before: string | null;
  after: string | null;
}

/** The created/deleted facts a patch states without reading a blob. */
export interface OmpPatchExistence {
  existedBefore?: boolean;
  existsAfter?: boolean;
}

/** omp's marker for a deleted file in `sum`. */
const DELETED = '-';

function splitLines(text: string | null): string[] {
  return text === null ? [] : text.split('\n');
}

function joinLines(lines: string[]): string | null {
  return lines.length === 0 ? null : lines.join('\n');
}

function checksum(text: string | null): string {
  return text === null ? DELETED : Bun.hash(text).toString(36);
}

/** Apply omp's hunks; `undefined` when one addresses a range that is not there. */
function applyHunks(lines: string[], hunks: unknown): string[] | undefined {
  if (!Array.isArray(hunks)) return undefined;
  const out: string[] = [];
  let cursor = 0;
  for (const hunk of hunks) {
    if (!Array.isArray(hunk) || hunk.length !== 3) return undefined;
    const [start, count, inserted] = hunk;
    if (typeof start !== 'number' || !Number.isInteger(start)) return undefined;
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) return undefined;
    if (!Array.isArray(inserted)) return undefined;
    if (start < cursor || start + count > lines.length) return undefined;
    out.push(...lines.slice(cursor, start), ...inserted);
    cursor = start + count;
  }
  out.push(...lines.slice(cursor));
  return out;
}

/** The session's omp blob directory, or `null` when it has no session file. */
export async function ompBlobDir(sessionId: string): Promise<string | null> {
  const sessionFile = await findSessionFileById(sessionId);
  return sessionFile ? path.join(siblingDirForSession(sessionFile), 'blobs') : null;
}

async function readBlobText(dir: string | null, key: string): Promise<string | undefined> {
  if (!dir) return undefined;
  try {
    const bytes = await Bun.file(path.join(dir, key)).bytes();
    return new TextDecoder().decode(Bun.gunzipSync(bytes));
  } catch {
    return undefined;
  }
}

/** A hunk list, inline or behind a blob key. */
async function readHunks(value: unknown, dir: string | null): Promise<unknown> {
  if (typeof value !== 'string') return value;
  const text = await readBlobText(dir, value);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

async function resolveBefore(
  patch: OmpPatch,
  previous: { lines: string[]; text: string | null } | undefined,
  dir: string | null,
): Promise<{ lines: string[]; text: string | null } | undefined> {
  if (patch.base !== undefined) {
    const text = patch.base === null ? null : await readBlobText(dir, patch.base);
    if (text === undefined) return undefined;
    return { lines: splitLines(text), text };
  }
  if (!previous || patch.gap === undefined) return previous;
  const hunks = await readHunks(patch.gap, dir);
  if (hunks === undefined) return undefined;
  const lines = applyHunks(previous.lines, hunks);
  return lines ? { lines, text: joinLines(lines) } : undefined;
}

/**
 * The two sides of each patch for ONE path, in journal order.
 *
 * An entry is `undefined` where the chain cannot be rebuilt. A later break does
 * not invalidate an earlier pair — each is verified against its own `sum` — but
 * it does end the chain, so a following record with no `base` is unknown too.
 */
export async function readPatchSides(
  sessionId: string,
  patches: readonly (OmpPatch | undefined)[],
): Promise<(OmpPatchSides | undefined)[]> {
  const dir = await ompBlobDir(sessionId);
  const sides: (OmpPatchSides | undefined)[] = [];
  let previous: { lines: string[]; text: string | null } | undefined;
  for (const patch of patches) {
    if (!patch) {
      sides.push(undefined);
      previous = undefined;
      continue;
    }
    const before = await resolveBefore(patch, previous, dir);
    const hunks = patch.edit === undefined ? undefined : await readHunks(patch.edit, dir);
    const afterLines = before && hunks !== undefined ? applyHunks(before.lines, hunks) : undefined;
    const after = afterLines ? { lines: afterLines, text: joinLines(afterLines) } : undefined;
    previous = after;
    if (!before || !after || checksum(after.text) !== patch.sum) {
      sides.push(undefined);
      previous = undefined;
      continue;
    }
    sides.push({ before: before.text, after: after.text });
  }
  return sides;
}

/**
 * The created/deleted facts of one path's patches, in journal order.
 *
 * Metadata only, so the per-run file list can label `A`/`D` without reading
 * content: `base: null` is a first write to a missing file, `sum: '-'` is a
 * deletion, and a record with no `base` inherits existence from the previous
 * `after` in the chain. A record without a patch ends the chain.
 */
export function patchExistence(patches: readonly (OmpPatch | undefined)[]): OmpPatchExistence[] {
  let previous: boolean | undefined;
  return patches.map((patch) => {
    if (!patch) {
      previous = undefined;
      return {};
    }
    const existedBefore = patch.base === undefined ? previous : patch.base !== null;
    const existsAfter = patch.sum === undefined ? undefined : patch.sum !== DELETED;
    previous = existsAfter;
    return {
      ...(existedBefore === undefined ? {} : { existedBefore }),
      ...(existsAfter === undefined ? {} : { existsAfter }),
    };
  });
}
