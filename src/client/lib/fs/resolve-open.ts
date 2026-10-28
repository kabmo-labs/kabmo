/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Turning an absolute path the OS handed over into a tab's scope.
 *
 * Three gestures produce one: a file dropped on the editor, a double-click in
 * Finder/Explorer, and "Open With → Kabmo". All three name a file ABSOLUTELY —
 * a file manager cannot know which workspace the page considers active — while
 * every other surface in Kabmo works from `root` + a path relative to it.
 *
 * The server does the translation (`/api/fs/scope`) through the allow-list that
 * governs every fs route, and this module adds the one step a real gesture
 * needs: a file outside every workspace is refused with
 * `code: 'outside_workspace'`, and THAT is a refusal the user can answer — they
 * pointed at the file — so it retries through `POST /api/fs/grant`, which
 * registers the file's own directory and answers the same payload.
 *
 * The order matters and is not an optimisation. A file inside a workspace must
 * NOT be granted: a grant is a lasting permission for a directory, and the list
 * is bounded, so granting every ordinary open would evict the real ones.
 */

/** The scope a tab needs, as both routes answer it. */
export interface ResolvedFileScope {
  root: string;
  path: string;
  name: string;
  /** The editor's classification: `text`, `image`, `document`, … */
  kind?: string;
  size?: number;
  /** The sentence for a kind the editor cannot show, when there is one. */
  error?: string;
}

export type OpenableFile =
  | { ok: true; file: ResolvedFileScope }
  | { ok: false; message: string };

/** The refusal body, which carries the one code this retries on. */
interface ScopeRefusal {
  error?: string;
  code?: string;
}

async function readBody(res: Response): Promise<ResolvedFileScope & ScopeRefusal> {
  return ((await res.json().catch(() => null)) ?? {}) as ResolvedFileScope & ScopeRefusal;
}

/**
 * Resolve `reference` (an absolute path, or a `file://` URL) to a scope a tab
 * can open.
 *
 * A file the editor cannot show is reported here, with the server's own
 * sentence, rather than opened as a tab whose whole content is that sentence.
 */
export async function resolveOpenableFile(reference: string): Promise<OpenableFile> {
  let res: Response;
  try {
    res = await fetch(`/api/fs/scope?path=${encodeURIComponent(reference)}`);
  } catch {
    return { ok: false, message: 'Could not reach the console to open that file.' };
  }

  let body = await readBody(res);
  if (!res.ok && body.code === 'outside_workspace') {
    // The file is real and the user pointed at it; the only thing missing is
    // permission for its directory.
    try {
      res = await fetch('/api/fs/grant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: reference }),
      });
    } catch {
      return { ok: false, message: 'Could not reach the console to open that file.' };
    }
    body = await readBody(res);
  }

  if (!res.ok || !body.path || !body.root) {
    return { ok: false, message: body.error ?? `Could not open that file (HTTP ${res.status}).` };
  }
  if (body.kind === 'binary' || body.kind === 'too-large') {
    return { ok: false, message: body.error ?? `${body.name ?? body.path} cannot be opened here.` };
  }
  return { ok: true, file: { root: body.root, path: body.path, name: body.name, kind: body.kind, size: body.size } };
}
