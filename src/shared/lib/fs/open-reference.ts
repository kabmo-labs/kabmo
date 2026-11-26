/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Where a file reference written in chat actually lives.
 *
 * A reference with a directory is opened as written: the tab's root is the
 * active workspace, which is the scope the agent was working in. A BARE name
 * (`App.tsx`, `AGENTS.md`) is not a location — the file can sit in any folder —
 * so it is looked up in the flat `/api/fs/list` index the quick-open picker
 * already uses. The three answers are the honest ones:
 *
 *  - one match: open that path (and reveal the line, when the span named one);
 *  - several: do not guess — open the picker filtered to the name;
 *  - none: open the reference as written, so the editor reports the missing
 *    file instead of the click doing nothing.
 *
 * Pure: the caller fetches the index, this decides.
 */

import { lastPathSegment } from '@kabmo-labs/kabmo-fs/media/paths';

/** One file reference, as the inline-code detector produced it. */
export interface InlineFileTarget {
  path: string;
  line?: number;
}

/** What a click on the reference should do. */
export type FileTargetDecision =
  | { kind: 'open'; path: string; line?: number }
  | { kind: 'pick'; query: string }
  | { kind: 'literal'; path: string; line?: number };

/** The minimum a quick-open entry must carry: its workspace-relative path. */
export interface IndexedPath {
  path: string;
}

/** One decision with the line carried through, without an `undefined` key. */
function withLine(
  kind: 'open' | 'literal',
  path: string,
  line: number | undefined,
): FileTargetDecision {
  return line === undefined ? { kind, path } : { kind, path, line };
}

/**
 * The action for `reference` given the workspace file index.
 *
 * The index is only consulted for a bare name: a path with a directory already
 * says where it is, and asking the index about it would add a request to the
 * common case. An EXACT index entry wins before the basename comparison, so a
 * root-level `AGENTS.md` opens that file rather than the picker — a picker over
 * the root copy and one in `docs/` would be noise, not a choice.
 */
export function chooseFileTarget(
  reference: InlineFileTarget,
  entries: readonly IndexedPath[],
): FileTargetDecision {
  const { path, line } = reference;
  if (path.includes('/')) return withLine('open', path, line);

  if (entries.some((entry) => entry.path === path)) return withLine('open', path, line);

  const name = lastPathSegment(path);
  const matches = entries.filter((entry) => lastPathSegment(entry.path) === name);
  if (matches.length === 1) return withLine('open', matches[0].path, line);
  if (matches.length > 1) return { kind: 'pick', query: name };
  return withLine('literal', path, line);
}
