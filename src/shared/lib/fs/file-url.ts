/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A `file://` URL to the path it names.
 *
 * Shared rather than private to the scope route, because the transformation is
 * platform-specific and a private copy can only be exercised on the platform it
 * was written on: the Windows branch below was wrong for as long as it lived
 * inside a route whose test skipped Windows.
 *
 * Two rules, both measured:
 *
 * - **The pathname is percent-encoded** — a space is `%20`, and a Finder drop of
 *   `My Notes.md` is exactly that — so decoding is not optional.
 *   `decodeURIComponent` throws on a malformed escape, which is answered as
 *   "not a path" rather than surfacing as a 500.
 * - **A WINDOWS drive letter loses its leading slash.** `new URL('file://C:\a\b.ts')`
 *   and the canonical `file:///C:/a/b.ts` BOTH answer `/C:/a/b.ts`, and
 *   `path.resolve` on win32 turns that into `\C:\a\b.ts` — a path under the
 *   current DRIVE's root, which no workspace contains. On the Windows CI leg
 *   every dropped file was refused with "outside every workspace", so a file
 *   dropped on the editor opened nothing at all. `fileURLToPath` drops the same
 *   slash; this does it without a `node:url` import in a shared module.
 */
export function pathFromFileUrl(reference: string): string | null {
  if (!/^file:\/\//i.test(reference)) return null;
  try {
    const pathname = decodeURIComponent(new URL(reference).pathname);
    // `/C:/…` → `C:/…`; `/tmp/…` is left alone.
    return /^\/[A-Za-z]:[\\/]/.test(pathname) ? pathname.slice(1) : pathname;
  } catch {
    return null;
  }
}
