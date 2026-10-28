/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Save As: write the buffer to a NEW path.
 *
 * ## What the server does, and what it deliberately does not
 *
 * One `POST /api/fs/action` with `actionType: 'saveAs'`: create the destination and
 * write the bytes. It does NOT delete the original, does not copy its permissions or
 * mtime, and does not ask the Files panel to refresh — those are three different
 * decisions and only the first is "save as".
 *
 * **A destination that already exists is refused, not overwritten.** The same rule the
 * Files panel's `create` applies: an overwrite is what `save` is for, and a dialog whose
 * "Save" silently replaced a file the user did not name is the worst possible outcome of
 * a mis-click. The refusal is a `409` carrying the reason, so the dialog can stay open
 * with the name still in it.
 *
 * **The write is a new file, so there is no `baseMtime`.** A conflict guard compares a
 * buffer against the bytes it was read from; a file that did not exist a moment ago has
 * nothing to compare, and sending the ORIGINAL's mtime would refuse every Save As.
 *
 * ## The destination is a path plus a name, and the path is validated on the server
 *
 * The dialog builds `parent/name`, but the server re-resolves both against its own root
 * allow-list: a client-supplied absolute path is exactly the shape that would let a
 * crafted request write outside the workspace.
 */

/** What a Save As attempt answers. */
export type SaveAsOutcome =
  /** Written; `path` is workspace-relative, which is what a tab needs. */
  | { status: 'written'; path: string }
  /** The destination exists. `reason` is the server's own sentence. */
  | { status: 'exists'; reason: string }
  /** Anything else: a bad name, a scope refusal, a dropped request. */
  | { status: 'failed'; reason: string };

interface SaveAsOptions {
  /** Workspace-relative directory the new file lands in. `''` means the scope root. */
  parent: string;
  /** One path segment — the server refuses a name carrying a separator. */
  name: string;
  /** The buffer, LF-only. The server rebuilds the bytes with `eol`. */
  content: string;
  eol: 'lf' | 'crlf';
  root?: string;
  repo?: string;
}

/** What `/api/fs/action` answers for a saveAs. */
interface SaveAsResponse {
  success?: unknown;
  path?: unknown;
  error?: unknown;
}

/**
 * Write `content` to `parent/name`.
 *
 * The name is trimmed and refused when empty HERE as well as on the server: a dialog
 * that posted an empty name would get a `400` and could only report a failure, while the
 * user's actual mistake ("you did not type a name") is one the caller can show inline.
 */
export async function saveFileAs(options: SaveAsOptions): Promise<SaveAsOutcome> {
  const name = options.name.trim();
  if (!name) return { status: 'failed', reason: 'Enter a file name.' };

  const formData = new FormData();
  formData.append('actionType', 'saveAs');
  formData.append('path', options.parent);
  formData.append('name', name);
  formData.append('content', options.content);
  formData.append('eol', options.eol);
  if (options.root) formData.append('root', options.root);
  if (options.repo && options.repo !== '.') formData.append('repo', options.repo);

  try {
    const res = await fetch('/api/fs/action', { method: 'POST', body: formData });
    const data = (await res.json().catch(() => null)) as SaveAsResponse | null;
    const reason = typeof data?.error === 'string' ? data.error : null;
    if (res.status === 409) {
      return { status: 'exists', reason: reason ?? `${name} already exists.` };
    }
    if (res.ok && data?.success && typeof data.path === 'string') {
      return { status: 'written', path: data.path };
    }
    return { status: 'failed', reason: reason ?? 'The file could not be written.' };
  } catch {
    return { status: 'failed', reason: 'The file could not be written.' };
  }
}

/**
 * The name a Save As dialog starts with.
 *
 * `notes.ts` → `notes copy.ts`, not `notes copy` — a destination that loses the
 * extension would be saved as a file the editor no longer recognises, and the language
 * the surface resolved would change under the user.
 */
export function saveAsSuggestedName(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0) return `${fileName} copy`;
  return `${fileName.slice(0, dot)} copy${fileName.slice(dot)}`;
}

/**
 * Whether a typed name is one path segment, as the DIALOG checks it before posting.
 *
 * The server's own `isSinglePathSegment` is the authority (it also normalizes and refuses
 * a NUL byte); this is the same shape minus the syscall-level cases, so the dialog can
 * name the problem inline instead of posting a request it knows will be refused.
 */
export function isSingleSegmentName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  if (trimmed === '.' || trimmed === '..') return false;
  return !trimmed.includes('/') && !trimmed.includes('\\');
}
