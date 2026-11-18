/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Paths named by an `apply_patch` payload.
 *
 * The codex/Claude patch tool sends the patch as text (`args.input`,
 * `args.patch`, `args.patchText`), not as a path. The headers are the only
 * place the paths appear:
 *
 *   *** Begin Patch
 *   *** Update File: src/a.ts
 *   *** Add File: src/b.ts
 *   *** Delete File: src/c.ts
 *   *** Move to: src/d.ts
 *   *** End Patch
 *
 * A `Move to` names the destination; the source is the preceding `Update File`
 * header, so both are returned and the capture snapshots both sides.
 */

const FILE_HEADER = /^\*\*\* (?:Update|Add|Delete) File: (.+)$/;
const MOVE_HEADER = /^\*\*\* Move to: (.+)$/;

export function patchPaths(text: string): string[] {
  const paths: string[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    const file = FILE_HEADER.exec(trimmed);
    if (file?.[1]) paths.push(file[1].trim());
    const move = MOVE_HEADER.exec(trimmed);
    if (move?.[1]) paths.push(move[1].trim());
  }
  return paths;
}
