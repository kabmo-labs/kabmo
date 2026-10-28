/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The phone's editor state, built from an `omp:open-file` / explorer payload.
 *
 * The payload is `unknown` at this boundary — the explorer, a plugin panel and
 * a drop all hand over their own object — so the shape is read with guards
 * rather than asserted. Two fields are load-bearing and were once dropped here:
 * `repo` (a file inside a nested repository resolves its raw URL against the
 * workspace root without it) and `handleId` (a dropped or launched file has no
 * server-reachable path, so its bytes come from the live handle instead).
 */

/** The one file the phone's full-screen editor has open. */
export interface MobileEditorFile {
  name: string;
  path?: string;
  content?: string;
  root?: string;
  /** Nested repo the path lives in, so a raw read resolves in the right tree. */
  repo?: string;
  /** A dropped/launched file's live handle — its bytes have no server path. */
  handleId?: string;
}

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** An empty string is a legitimate file body, so it is kept where `readString` would drop it. */
function readContent(source: Record<string, unknown>): string | undefined {
  const value = source.content;
  return typeof value === 'string' ? value : undefined;
}

/**
 * The editor state for a payload, or null when it names no file.
 *
 * `fallbackRoot` is the active project, applied only when the payload carries no
 * root of its own: a caller that knows its own scope (a preview's relative link,
 * a nested repo) must keep it.
 */
export function mobileEditorFileFrom(payload: unknown, fallbackRoot?: string | null): MobileEditorFile | null {
  const source = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>;
  const path = (readString(source, 'path') ?? '').replace(/^\/+/, '');
  if (!path) return null;
  const name = readString(source, 'name') ?? path.split('/').pop() ?? 'file';
  return {
    name,
    path,
    content: readContent(source),
    root: readString(source, 'root') ?? fallbackRoot ?? undefined,
    repo: readString(source, 'repo'),
    handleId: readString(source, 'handleId'),
  };
}
