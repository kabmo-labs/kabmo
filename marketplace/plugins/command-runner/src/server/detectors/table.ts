/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The detector table, assembled from one module per ecosystem family.
 *
 * ## Order is the order a walk reports groups in
 *
 * Grouped by FAMILY rather than alphabetically, because the families are what a
 * reader scans for. `package.json` stays FIRST, where it has always been: in this
 * ecosystem it is the source a reader looks for before any other, and a reorder
 * would move every existing user's list for no gain. Within a family, a row's
 * position is its priority for a shared basename — `package.json` before
 * `deno.json` so the JS answer comes first in a repo that has both.
 *
 * ## Adding a source is adding a ROW, and that is now true
 *
 * It used to take three coordinated edits — the table, `labelFor`, and `argvFor`
 * — which is exactly the shape where two of them drift and a row says `npm run
 * dev` while running something else. The detector now owns its argv and its label
 * is derived from it (`detectors/types.ts`), so a new source is one row here and
 * nothing else.
 */

import type { Detector } from './types';
import { JS_DETECTORS } from './js';
import { MAKE_DETECTORS } from './make';
import { PYTHON_DETECTORS } from './python';
import { NATIVE_DETECTORS } from './native';

export const DETECTORS: readonly Detector[] = [
  ...JS_DETECTORS,
  ...MAKE_DETECTORS,
  ...PYTHON_DETECTORS,
  ...NATIVE_DETECTORS,
];

/**
 * The detector for a file, or null when no source claims it.
 *
 * `repoPath` is the file's path relative to the scanned root, with `/`
 * separators, and it is what a `paths` row matches on. A row with no `paths` is
 * matched on the BASENAME alone, which is the common case.
 */
export function detectorFor(filename: string, repoPath?: string): Detector | null {
  for (const detector of DETECTORS) {
    if (detector.filenames.includes(filename)) return detector;
  }
  if (repoPath) {
    for (const detector of DETECTORS) {
      if (detector.paths?.some((suffix) => repoPath.endsWith(suffix))) return detector;
    }
  }
  return null;
}

/** Every filename any source claims, for the panel's "what was looked for" note. */
export function claimedFilenames(): string[] {
  return [...new Set(DETECTORS.flatMap((detector) => [...detector.filenames]))].sort();
}
