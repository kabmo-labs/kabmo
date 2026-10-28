/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A unified diff, split into the files it names.
 *
 * Two hosts hand back a diff as TEXT rather than a file list — Gitea's
 * `/pulls/:index.diff` and Bitbucket's `/pullrequests/:id/diff` — and the panel
 * wants the same shape the other two hosts answer with. So this is the one
 * parser between them, and it is deliberately narrow: it reads the file
 * boundaries, the status word and the hunk text, and it does NOT try to apply or
 * verify anything.
 *
 * Three facts are load-bearing:
 *
 * - **A header is `diff --git a/<path> b/<path>`**, and the two sides differ for
 *   a rename. The `b/` side is what the file IS now, so that is the path.
 * - **`new file mode` / `deleted file mode` / `rename from`** carry the status;
 *   `--- /dev/null` and `+++ /dev/null` are the other spelling of the same
 *   thing, and both appear in real diffs depending on the producer.
 * - **A count is the hunk's own `+`/`-` lines, not its header arithmetic.**
 *   `@@ -12,7 +12,9 @@` states the range, and a hunk whose body was elided (a host that truncates
 *   a large binary change) would report a count the body does not have.
 */

import type { ForgeFile } from '../protocol';

/** The paths in a `diff --git a/x b/y` header. */
const HEADER = /^diff --git (?:"?a\/)?(.+?)"?(?: (?:"?b\/)?(.+?)"?)?$/;

/** Start a new file record. */
function blank(path: string): ForgeFile {
  return { path, status: 'modified', additions: 0, deletions: 0, patch: '' };
}

/**
 * Parse one unified diff.
 *
 * A diff with no `diff --git` header at all (a raw patch from an unusual
 * producer) yields one file named `(diff)` rather than nothing: the text is
 * still worth showing, and dropping it would make the panel claim the change
 * touches no files.
 */
export function parseUnifiedDiff(text: string): ForgeFile[] {
  const lines = text.split('\n');
  const files: ForgeFile[] = [];
  let current: ForgeFile | null = null;
  /** Lines of the hunk body, accumulated so the patch keeps its context. */
  let body: string[] = [];

  const flush = () => {
    if (!current) return;
    current.patch = body.join('\n').trim();
    files.push(current);
    current = null;
    body = [];
  };

  for (const line of lines) {
    const header = line.match(HEADER);
    if (header) {
      flush();
      const path = (header[2] ?? header[1] ?? '').trim();
      current = blank(path);
      continue;
    }

    if (!current) {
      // Text before the first header is a preamble (`Binary files differ`, a
      // signature); it belongs to no file, so it is dropped rather than
      // attributed to the next one.
      if (line.startsWith('--- ') || line.startsWith('+++ ')) continue;
      if (!line.trim()) continue;
      current = blank('(diff)');
    }

    if (line.startsWith('new file mode')) {
      current.status = 'added';
      continue;
    }
    if (line.startsWith('deleted file mode')) {
      current.status = 'removed';
      continue;
    }
    if (line.startsWith('rename from ')) {
      current.status = 'renamed';
      continue;
    }
    if (line.startsWith('--- ')) {
      if (line.includes('/dev/null')) current.status = 'added';
      continue;
    }
    if (line.startsWith('+++ ')) {
      if (line.includes('/dev/null')) current.status = 'removed';
      continue;
    }
    // A file-level metadata line (`index abc..def`, `similarity index 92%`).
    if (/^(index |similarity index|old mode|new mode|Binary files)/.test(line)) continue;

    if (line.startsWith('+')) current.additions += 1;
    else if (line.startsWith('-')) current.deletions += 1;
    body.push(line);
  }

  flush();
  return files;
}

/**
 * Whether a diff is worth rendering.
 *
 * A binary change produces `Binary files … differ` and no hunks, so a panel that
 * draws it as an empty code block looks broken. The caller shows the file's name
 * and status instead.
 */
export function hasHunks(file: ForgeFile): boolean {
  return file.patch.includes('@@') || file.patch.startsWith('+') || file.patch.startsWith('-');
}
