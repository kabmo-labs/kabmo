/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { json, type LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { listDirectoryEntries } from '@/server/lib/fs/listing';
import { errorResponse } from '@/server/lib/route-adapter';
import { homedir } from 'os';
import { dirname, isAbsolute, join, resolve } from 'path';
import fs from 'fs';
import path from 'path';
import { isMockMode } from '@/server/mock.server';
import { getDefaultFsRoot, resolveReferencedPath, resolveRoot, resolveWithinRoot } from '@/server/lib/fs/root';
import {
  BINARY_SNIFF_BYTES,
  classifyEditorFile,
  unsupportedEditorMessage,
  type EditorFileKind,
} from '@/shared/lib/fs/file-kind';

/**
 * Classify a file the way the editor will, reading only as many bytes as the
 * sniff needs.
 *
 * The head is sliced rather than the whole file read, so the check costs 8 KiB
 * on a 4 GiB archive. `size` is passed in because the caller already has the
 * stat, and a file refused for size must not be read at all.
 */
async function classifyForEditor(fullPath: string, displayPath: string, size: number): Promise<EditorFileKind> {
  // An image and an oversize file are both settled by path and size alone; only
  // a candidate TEXT file needs its head.
  const provisional = classifyEditorFile({ path: displayPath, size });
  if (provisional !== 'text') return provisional;
  const head = await Bun.file(fullPath).slice(0, BINARY_SNIFF_BYTES).bytes();
  return classifyEditorFile({ path: displayPath, size, head });
}

/**
 * GET /api/fs/browse?path=<abs> — list subdirectories of a folder for the
 * workspace folder picker.
 *
 * Starts from the OS home directory when `path` is omitted. Only directories
 * are returned (a workspace is bound to a project root folder). Navigation is
 * confined to real absolute paths; entries that cannot be read are skipped so
 * one permission-denied folder does not break the whole listing.
 *
 * Response: { path, parentPath, directories: [{ name, path }] }
 */
const HIDDEN_ENTRY_PREFIXES = ['.', 'node_modules', 'Library'];

export async function browseDirectories({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const rawPath = url.searchParams.get('path');
  const home = homedir();

  let current: string;
  if (rawPath) {
    const candidate = rawPath.startsWith('~/')
      ? join(home, rawPath.slice(2))
      : rawPath === '~'
        ? home
        : rawPath;
    if (!isAbsolute(candidate)) {
      return json({ error: 'Path must be absolute', code: 'not_absolute' }, { status: 400 });
    }
    current = resolve(candidate);
  } else {
    current = home;
  }

  let names: string[] = [];
  try {
    // `isDirectory()` on the dirent is the whole test: `readdir` fills it from
    // the entry's own type, and it is false for a symlink (even one pointing at
    // a directory), which is the "real directories only" rule. Re-statting each
    // survivor through `Bun.file().stat()` answered the same question a second
    // time for 34 µs per listing (measured 0.067 ms → 0.033 ms per 200 calls).
    names = (await fs.promises.readdir(current, { withFileTypes: true }))
      .filter((d) => d.isDirectory() && !HIDDEN_ENTRY_PREFIXES.some((p) => d.name.startsWith(p)))
      .map((d) => d.name);
  } catch {
    return json({ error: `Cannot read directory: ${current}`, code: 'unreadable' }, { status: 400 });
  }

  const directories = names
    .map((name) => ({ name, path: join(current, name) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const parent = current === home ? null : dirname(current);
  return json({
    path: current,
    parentPath: parent === current ? null : parent,
    directories,
  });
}

// No name is filtered: `lib/fs/listing.ts` (shared with the realtime topic)
// lists every entry, and git-ignored ones are dimmed rather than dropped.
//
// Lazy listing: return only the immediate children of a directory. Folders are
// emitted with `children: null` meaning "not loaded yet" so the client can
// fetch them on demand — directories are NOT recursed here (keeps the initial
// payload tiny for deep workspaces). Hidden (dot-prefixed) entries are part of
// the listing: lazy children keep `.github`, `.config`, `.env`, … cheap.
// Entries git would refuse to track carry `ignored: true` so the panel can dim
// them; that is one `git check-ignore` per listing, never one per entry.
export async function listDirectory({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const mock = isMockMode();
  let baseDir = await resolveRoot(url.searchParams.get('root'), await getDefaultFsRoot(mock));

  // Browse inside a nested git repo; emitted paths are repo-relative to match GitPanel.
  const repo = url.searchParams.get('repo');
  if (repo && repo !== '.') {
    const repoDir = resolveWithinRoot(baseDir, repo);
    if (!repoDir) {
      return json({ error: 'Invalid repo path' }, { status: 403 });
    }
    baseDir = repoDir;
  }

  const targetPath = url.searchParams.get('path') || '.';
  const fullPath = resolveWithinRoot(baseDir, targetPath);

  // Security check to prevent traversing outside the scoped root
  if (!fullPath) {
    return json({ error: 'Invalid path' }, { status: 403 });
  }

  try {
    const files = await listDirectoryEntries(fullPath, baseDir);
    return json({ files, isMock: mock, root: baseDir, path: targetPath });
  } catch (error) {
    console.error(error);
    return json({ error: 'Failed to read directory', isMock: mock }, { status: 500 });
  }
}

/** Hard cap on emitted files so a huge tree cannot stall the request. */
const MAX_FILES = 3000;

/**
 * Directory names the RECURSIVE walk does not descend into.
 *
 * This is a budget guard, not the Files panel's noise table (there is none any
 * more — `lib/fs/listing.ts` lists every entry). `/api/fs/list` returns a flat
 * file index capped at `MAX_FILES` for the composer's `@` picker, and
 * descending into a dependency tree spends that whole budget inside
 * `node_modules` — leaving the picker with no project file in it. The tree
 * panel is unaffected: it lists lazily, one directory per request, so a folder
 * is only walked when someone expands it.
 */
const SKIP_DIRS: Record<string, true> = {
  node_modules: true,
  '.git': true,
  dist: true,
  build: true,
  '.next': true,
  '.cache': true,
  coverage: true,
};

interface ListFileEntry {
  name: string;
  path: string;
}

/**
 * Recursively collect files under `dir`, emitting each as a workspace-relative
 * path from `baseDir`. Hidden entries, skip-listed dirs, and symlinks (which
 * could cycle) are ignored; unreadable directories are skipped silently.
 */
async function walk(dir: string, baseDir: string, out: ListFileEntry[]): Promise<void> {
  if (out.length >= MAX_FILES) return;

  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (out.length >= MAX_FILES) return;

    if (entry.name.startsWith('.')) continue;

    if (entry.isDirectory()) {
      if (SKIP_DIRS[entry.name]) continue;
      await walk(path.join(dir, entry.name), baseDir, out);
      continue;
    }

    // Emit only regular files: symlinks (to files or dirs) are skipped so a
    // directory symlink cannot introduce a cycle.
    if (!entry.isFile()) continue;

    const rel = path.relative(baseDir, path.join(dir, entry.name)).split(path.sep).join('/');
    out.push({ name: entry.name, path: rel });
  }
}

export async function listFiles({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const mock = isMockMode();
  const baseDir = await resolveRoot(url.searchParams.get('root'), await getDefaultFsRoot(mock));

  try {
    const files: ListFileEntry[] = [];
    await walk(baseDir, baseDir, files);
    files.sort((a, b) => a.path.localeCompare(b.path));
    return json({ files, root: baseDir, truncated: files.length >= MAX_FILES });
  } catch (error) {
    console.error(error);
    return json({ error: 'Failed to list files' }, { status: 500 });
  }
}

export async function readFile({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const filePath = url.searchParams.get('path');

  if (!filePath) {
    return json({ error: 'Missing path' }, { status: 400 });
  }
  let baseDir = await resolveRoot(url.searchParams.get('root'), await getDefaultFsRoot(isMockMode()));

  // If repo is specified (e.g. nested git project), resolve inside the repo
  const repo = url.searchParams.get('repo');
  if (repo && repo !== '.') {
    const repoDir = resolveWithinRoot(baseDir, repo);
    if (repoDir) {
      baseDir = repoDir;
    }
  }

  const cleanPath = filePath.replace(/^\/+/, '');
  const fullPath = resolveWithinRoot(baseDir, cleanPath);

  if (!fullPath) {
    return json({ error: 'Invalid path' }, { status: 403 });
  }

  try {
    const file = Bun.file(fullPath);
    if (!(await file.exists())) {
      return json({ error: 'File not found' }, { status: 404 });
    }
    const stat = await file.stat();
    if (stat.isDirectory()) {
      return json({ error: 'Cannot read a directory' }, { status: 400 });
    }

    // An image has no text: decoding its bytes here returned replacement
    // characters, which every reader painted as mojibake. Every in-repo reader
    // branches on the extension first and takes `/api/fs/raw`, so this answers
    // the remaining callers with the real reason instead of garbage.
    //
    // A document (PDF/DOCX/XLSX) is the same answer for the same reason — its
    // viewer fetches the bytes from the raw route — but a DIFFERENT sentence:
    // "served by /api/fs/raw" tells the caller where to look, and a document is
    // not an image.
    //
    // A binary or oversized file is refused the same way, and the refusal is
    // the point rather than a nicety: the editor's buffer is empty on a failed
    // read, and Save is only disabled by `loadError`. Answering with mojibake
    // left a buffer the next save wrote straight back over the real file.
    const kind = await classifyForEditor(fullPath, cleanPath, stat.size);
    if (kind === 'image' || kind === 'document') {
      return json({ error: 'This file is served by /api/fs/raw' }, { status: 400 });
    }
    if (kind !== 'text') {
      return json(
        { error: unsupportedEditorMessage(kind, stat.size, cleanPath), kind },
        { status: 415 },
      );
    }

    const content = await file.text();
    return json({ content });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * GET /api/fs/read-reference?path=<abs path or URL> — read a file a drop or a
 * link pointed at.
 *
 * A download dragged out of a web page (WhatsApp Web, Gmail, Slack) carries no
 * bytes, only a reference, and the page cannot fetch a `file://` path itself.
 * The path is therefore resolved against the same allow-list that governs a
 * client-supplied `root` — the app root, a path beneath it, or a registered
 * workspace — so this cannot be used to read an arbitrary file.
 *
 * Text only: an image or binary has no string form to return, and the drop's
 * own `File` is the path that carries those.
 */
export async function readReferencedFile({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const reference = url.searchParams.get('path');
  if (!reference) {
    return json({ error: 'Missing path' }, { status: 400 });
  }

  // A remote reference is not fetched here: Kabmo has no policy for
  // outbound requests and a drag from a page is not a reason to add one.
  if (/^https?:\/\//i.test(reference)) {
    return json({ error: 'Remote references are not supported' }, { status: 400 });
  }

  const filePath = await resolveReferencedPath(reference.replace(/^file:\/\//, ''));
  if (!filePath) {
    return json({ error: 'File not found' }, { status: 404 });
  }

  try {
    const file = Bun.file(filePath);
    const stat = await file.stat();
    if (stat.isDirectory()) {
      return json({ error: 'Cannot read a directory' }, { status: 400 });
    }
    // Same classification as `/api/fs/read`: a binary or oversized reference is
    // refused with its reason rather than handed back as mojibake. A document
    // has no text form either — its viewer takes the bytes from the drop's own
    // `File`, not from this route.
    const kind = await classifyForEditor(filePath, filePath, stat.size);
    if (kind === 'image' || kind === 'document') {
      return json({ error: 'This file is served by /api/fs/raw' }, { status: 400 });
    }
    if (kind !== 'text') {
      return json({ error: unsupportedEditorMessage(kind, stat.size, filePath), kind }, { status: 415 });
    }
    return json({ content: await file.text(), name: path.basename(filePath) });
  } catch (error) {
    return errorResponse(error);
  }
}
