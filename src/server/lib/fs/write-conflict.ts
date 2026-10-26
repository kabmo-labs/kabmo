/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The save path's conflict check, as one testable function.
 *
 * Kept out of `action.ts` because it is the only part of that handler with a rule
 * worth pinning, and because the rule has three branches that all look alike in a
 * handler:
 *
 * - **No `baseMtime` → no expectation.** A handle-backed file has no server path
 *   and an older client sends nothing; both must write unconditionally, which is
 *   the contract this feature is layered onto rather than replaces.
 * - **A missing file is not a conflict.** `confirmSaveMissing` is what allows
 *   recreating a deleted file, and there is no mtime to disagree with.
 * - **A moved mtime IS a conflict**, and the verdict carries the CURRENT value so
 *   the client can offer Reload/Keep instead of reporting a failure.
 *
 * ## The comparison is exact, and its one blind spot is a millisecond
 *
 * An editor writes whole files, so a moved mtime is a real change. The blind spot is
 * two writes inside the SAME millisecond: the filesystem's `mtimeMs` does not move,
 * so the guard cannot tell them apart. Measured on this filesystem — two
 * `writeFileSync` calls in a row leave the value identical. That is accepted rather
 * than papered over with a tolerance, which would widen the hole instead of closing
 * it; a content hash would close it and cost a full read per save, which is the wrong
 * trade for a guard whose job is the common case (a tool call, another tab, a
 * `git checkout` — all of which take far longer than a millisecond).
 */

/** What the file on disk says about the buffer's base. */
export interface ConflictVerdict {
  /** The save may proceed. */
  write: boolean;
  /** The mtime on disk right now; `null` when the file is gone. */
  diskMtimeMs: number | null;
}

/**
 * An mtime rounded to a whole millisecond.
 *
 * Load-bearing, and measured: `node:fs`' `statSync` and `Bun.file().stat()` disagree
 * on the FRACTIONAL part of `mtimeMs` for the same file, so a comparison of the raw
 * values answers "conflict" for a file nobody touched — a save loop the user can never
 * get out of. Whole milliseconds are what both agree on, and what survives a JSON
 * round trip exactly.
 */
export function stableMtime(mtimeMs: number): number {
  return Math.round(mtimeMs);
}

/**
 * Whether a save may proceed, given the buffer's base mtime.
 *
 * `baseMtimeMs` is `undefined`/`null` when the caller has no expectation — that is
 * the "write unconditionally" case, not an error.
 */
export async function checkWriteConflict(
  fullPath: string,
  baseMtimeMs: number | null | undefined,
  stat: (path: string) => Promise<{ mtimeMs: number } | null>,
): Promise<ConflictVerdict> {
  if (typeof baseMtimeMs !== 'number') return { write: true, diskMtimeMs: null };
  const current = await stat(fullPath);
  // The file is gone: recreating it is `confirmSaveMissing`'s decision, which the
  // caller has already made by the time it gets here.
  if (!current) return { write: true, diskMtimeMs: null };
  const disk = stableMtime(current.mtimeMs);
  return { write: disk === stableMtime(baseMtimeMs), diskMtimeMs: disk };
}

/**
 * The `baseMtime` a save request carries, or `undefined`.
 *
 * A missing field and a malformed one are the same answer — "no expectation" —
 * because the alternative is refusing a legitimate save over a parsing detail.
 */
export function parseBaseMtime(raw: FormDataEntryValue | null): number | undefined {
  if (typeof raw !== 'string' || raw === '') return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}
