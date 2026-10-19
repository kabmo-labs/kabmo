/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * GET /api/fs/scope?path=<abs path or file:// URL> — turn an absolute path into
 * the scope the editor panel speaks.
 *
 * A file dropped on the editor is named absolutely: a file manager cannot know
 * which workspace the page considers active, and the same is true of a path
 * handed over by the OS. Every other surface in Kabmo works from
 * `root` + a path RELATIVE to it, and the read and save routes resolve that
 * pair back through the same allow-list this route applies. So a drop has to be
 * translated once, here, rather than teaching the editor a second path shape it
 * would then have to keep in sync with every save.
 *
 * The allow-list is the point, not an obstacle: `/api/fs/read` refuses a `root`
 * it does not recognise, so answering with a scope the reader will reject is
 * worse than refusing now — the refusal can name the reason.
 *
 * The file's KIND travels with the answer so the drop target can decline a
 * binary or oversized file before opening a tab that would only report it.
 */

import { json, type LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { resolveScopeForAbsolutePath } from '@/server/lib/fs/root';
import { BINARY_SNIFF_BYTES, classifyEditorFile, unsupportedEditorMessage } from '@/shared/lib/fs/file-kind';
import fs from 'fs';
import path from 'path';

/**
 * A `file://` URL to the path it names.
 *
 * The pathname is percent-encoded (a space is `%20`, and a Finder drop of
 * `My Notes.md` is exactly that), so decoding is not optional. `decodeURIComponent`
 * can throw on a malformed escape, which is answered as "not a path" rather
 * than surfacing as a 500.
 */
function pathFromReference(reference: string): string | null {
  if (!/^file:\/\//i.test(reference)) return reference;
  try {
    const url = new URL(reference);
    return decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
}

export async function resolveFileScope({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const raw = url.searchParams.get('path');
  if (!raw) {
    return json({ error: 'Missing path' }, { status: 400 });
  }

  const reference = pathFromReference(raw);
  if (!reference) {
    return json({ error: 'Malformed file URL' }, { status: 400 });
  }

  const scope = await resolveScopeForAbsolutePath(reference);
  if (!scope) {
    return json(
      { error: 'That file is outside every workspace this console can read.' },
      { status: 403 },
    );
  }

  const fullPath = path.resolve(scope.root, scope.path);
  // `Bun.file().exists()` is false for a directory, so a folder dropped on the
  // editor would be answered "File not found" — true as far as the file is
  // concerned, and useless to the user. `statSync` sees either shape, so the
  // refusal can name the folder it actually is.
  const stat = await fs.promises.stat(fullPath).catch(() => null);
  if (!stat) {
    return json({ error: 'File not found' }, { status: 404 });
  }
  if (stat.isDirectory()) {
    return json({ error: 'That is a folder, not a file.' }, { status: 400 });
  }

  // The same classification the read route applies, so the drop can refuse what
  // the reader would: a binary or oversized file is answered as such here
  // instead of opening a tab whose whole content is a refusal message.
  const file = Bun.file(fullPath);
  const provisional = classifyEditorFile({ path: scope.path, size: stat.size });
  const kind = provisional === 'text'
    ? classifyEditorFile({
        path: scope.path,
        size: stat.size,
        head: await file.slice(0, BINARY_SNIFF_BYTES).bytes(),
      })
    : provisional;

  return json({
    root: scope.root,
    path: scope.path,
    name: path.basename(scope.path),
    kind,
    size: stat.size,
    ...(kind === 'binary' || kind === 'too-large'
      ? { error: unsupportedEditorMessage(kind, stat.size, scope.path) }
      : {}),
  });
}
