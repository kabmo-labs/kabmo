/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Files panel's clipboard rules: what a Cut/Copy placed on the clipboard,
 * and which targets may accept a Paste.
 *
 * Pure and shared, because the CLIENT decides which menu rows to show (Paste is
 * offered only where it can land) and the SERVER decides whether the transfer is
 * legal (the panel is not the only caller a stale tab can reach). One rule,
 * both ends — a second copy is how the menu ends up offering a paste the route
 * then refuses.
 *
 * A clipboard entry is scoped the way every other Files-panel path is: `path` is
 * relative to the LISTED root, and `root\0repo` names which listing that is. A
 * paste into another workspace or nested repo is therefore not this entry's
 * destination, and `pasteRefusal` says so rather than silently moving a file the
 * user copied somewhere else.
 */

/** What a Cut or a Copy put on the clipboard. */
export interface FsClipboard {
  /** The `\0`-joined `root\0repo` the path is relative to. */
  scope: string;
  /** Path relative to the listed root; never `.` — the root itself cannot be moved. */
  path: string;
  name: string;
  kind: 'file' | 'folder';
  mode: 'copy' | 'cut';
}

/** The scope key a panel's listing uses: `${rootPath}\0${repo}`. */
export function fsClipboardScope(rootPath: string | undefined, repo: string): string {
  return `${rootPath ?? ''}\u0000${repo}`;
}

/**
 * The folder a paste into `targetPath` lands in: the folder itself, or the
 * file's own directory.
 *
 * Both ends compute it (the menu labels the destination, the route resolves it),
 * so the two must not disagree on where a paste beside a file goes.
 */
export function pasteTargetDir(targetPath: string, targetKind: 'file' | 'folder'): string {
  if (targetKind === 'folder') return targetPath;
  const cut = targetPath.lastIndexOf('/');
  return cut === -1 ? '.' : targetPath.slice(0, cut);
}

/**
 * The directory an entry lives in — the SOURCE side of `pasteTargetDir`, which
 * cannot answer it: a folder's destination is itself, but its parent is not.
 */
export function parentOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? '.' : path.slice(0, cut);
}

/**
 * The refusal a transfer of `source` into the folder `targetDir` carries, or
 * null when it may run. Both paths are relative to the same scoped root.
 *
 * Shared by BOTH ends: the menu hides Paste on an illegal target and the route
 * refuses it anyway, so a stale client cannot reach the filesystem through a
 * rule only the UI enforced. The descendant check is the one that cannot be
 * skipped — a folder pasted into its own subtree makes the destination a child
 * of the thing being moved, which never terminates.
 */
export function transferRefusal(
  source: { path: string; kind: 'file' | 'folder' },
  targetDir: string,
): string | null {
  // `.` is the scoped root itself: moving or copying it would retarget the whole
  // listing, and the clipboard never holds it (the root menu has no Cut/Copy).
  if (source.path === '' || source.path === '.') return 'The workspace root cannot be moved or copied';
  if (source.kind === 'folder' && (targetDir === source.path || targetDir.startsWith(`${source.path}/`))) {
    return 'Cannot paste a folder into itself';
  }
  return null;
}

/**
 * The refusal a MOVE of `source` into `targetDir` carries — the rule a drag
 * obeys, and the reason it is not just `transferRefusal`.
 *
 * A drag is always a move, so landing back in the directory the entry already
 * lives in is a no-op with nothing to report. A CUT only hits the same case
 * when the user pastes into the folder the entry is already in, which is why
 * `pasteRefusal` applies the same test to `mode: 'cut'` and not to a copy —
 * copying into one's own directory is how `a copy.ts` is made.
 */
export function dropRefusal(
  source: { path: string; kind: 'file' | 'folder' },
  targetDir: string,
): string | null {
  const refusal = transferRefusal(source, targetDir);
  if (refusal) return refusal;
  if (targetDir === parentOf(source.path)) return 'Already in this folder';
  return null;
}

/**
 * Whether a paste of `clip` into the folder `targetDir` is legal.
 *
 * `transferRefusal` plus the one check only a client can make: the clipboard
 * entry's scope is the listing it was copied from, and a paste into another
 * workspace or nested repo is a different listing — not this entry's
 * destination. The server cannot compare the two, because the client's scope is
 * built from the un-resolved `rootPath` (which may be `~`-relative) while the
 * route holds the resolved directory.
 */
export function pasteRefusal(clip: FsClipboard | null, scope: string, targetDir: string): string | null {
  if (!clip) return 'Nothing to paste';
  if (clip.scope !== scope) return 'The clipboard holds an entry from another workspace';
  // A cut has nothing to do in the folder it is already in — the entry would be
  // renamed to a `copy` name, which is the opposite of what a cut means. The
  // route refuses the same case in the same words.
  if (clip.mode === 'cut' && targetDir === parentOf(clip.path)) return 'Already in this folder';
  return transferRefusal(clip, targetDir);
}

/**
 * The first free name for `name` inside `taken`: `a.txt` → `a copy.txt` →
 * `a copy 2.txt`. A paste (or a duplicate) never overwrites, so a colliding
 * name is a reason to pick another, not to clobber the file already there.
 *
 * The extension stays on the end (`report.v2.md` → `report.v2 copy.md`) because
 * a suffix appended after it (`report.md copy`) reads as a different file type
 * to every editor that keys off the extension.
 */
export function uniqueName(name: string, taken: (candidate: string) => boolean): string {
  if (!taken(name)) return name;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  const first = `${base} copy${ext}`;
  if (!taken(first)) return first;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base} copy ${n}${ext}`;
    if (!taken(candidate)) return candidate;
  }
  return `${base} copy ${Date.now()}${ext}`;
}

/**
 * The name a Duplicate gives its new entry: a file takes the `uniqueName`
 * ladder (`a.txt` → `a copy.txt`), a folder its own (`src` → `src copy`),
 * because a folder carries no extension to preserve.
 */
export function duplicateName(name: string, kind: 'file' | 'folder', taken: (candidate: string) => boolean): string {
  if (kind === 'file') return uniqueName(name, taken);
  if (!taken(`${name} copy`)) return `${name} copy`;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${name} copy ${n}`;
    if (!taken(candidate)) return candidate;
  }
  return `${name} copy ${Date.now()}`;
}

/**
 * Guard a stored clipboard blob read back from session state.
 *
 * `session_ui_state` is a client-owned store, but it survives reloads and can
 * be hand-edited, and every path here ends in a filesystem call — so a blob
 * whose shape is not what Cut/Copy wrote is dropped rather than trusted. The
 * path check is the one that matters: a `.`, a `..` segment or an absolute
 * spelling would name a directory other than the one the entry claims.
 */
export function readFsClipboard(value: unknown): FsClipboard | null {
  if (typeof value !== 'object' || value === null) return null;
  const clip = value as Partial<FsClipboard>;
  if (typeof clip.scope !== 'string' || typeof clip.path !== 'string' || typeof clip.name !== 'string') return null;
  if (clip.kind !== 'file' && clip.kind !== 'folder') return null;
  if (clip.mode !== 'copy' && clip.mode !== 'cut') return null;
  const segments = clip.path.split('/');
  if (clip.path === '' || clip.path.startsWith('/') || segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return null;
  }
  return { scope: clip.scope, path: clip.path, name: clip.name, kind: clip.kind, mode: clip.mode };
}
