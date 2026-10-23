/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * One rule for every name the Files panel WRITES: a path relative to the folder
 * that was named, nested segments allowed, and nothing that can leave it.
 *
 * The panel's create and rename both used to accept a bare name only, which made
 * a nested path unreachable from the UI: creating `src/lib/parse.ts` meant
 * creating `src`, expanding it, then `lib`, then the file. The restriction was
 * never about safety — `resolveWithinRoot` already refuses an escape — it was
 * the shape of the input field, so the grammar is now stated once and both
 * callers read it.
 *
 * What is refused, and why each one is a distinct decision:
 *
 * - an ABSOLUTE path (`/etc/passwd`, `C:\x`): `path.join(dir, abs)` discards the
 *   folder the user named, so the write would land somewhere the dialog never
 *   showed. `resolveWithinRoot` catches most of it, but a drive-relative `C:x`
 *   normalizes under the root and would silently create a file named `C:x`.
 * - any `..` SEGMENT: the escape itself. `resolveWithinRoot` would refuse a
 *   result outside the root, but `a/../b.ts` resolves INSIDE it, so the refusal
 *   would be about the wrong thing — the user would get "Invalid path" for a
 *   path that looks fine.
 * - a NUL byte: it truncates the path at the syscall boundary.
 *
 * A backslash is treated as a separator rather than refused: a Windows user
 * types `src\lib\x.ts` into the same field, and refusing it would be a rule the
 * field cannot explain. Empty and `.` segments are dropped, so `src//x.ts` and
 * `./src/x.ts` name the same file as `src/x.ts`.
 *
 * Returns the normalized POSIX-relative path, or null when it names nothing.
 */
export function normalizeRelativePath(raw: string): string | null {
  const trimmed = raw.trim().replace(/\\/g, '/');
  if (!trimmed || trimmed.includes('\0')) return null;
  if (trimmed.startsWith('/') || /^[a-zA-Z]:/.test(trimmed)) return null;

  const segments: string[] = [];
  for (const segment of trimmed.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') return null;
    segments.push(segment);
  }
  return segments.length > 0 ? segments.join('/') : null;
}
