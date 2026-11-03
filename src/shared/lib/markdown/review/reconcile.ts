/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which stored marks still describe a block on screen, and which do not.
 *
 * A mark names its block by content (`type:hash#n`), so editing a block detaches
 * its mark: the stored quote no longer matches anything rendered. That is a
 * real state the reader must SEE — the note is still what they wrote, and the
 * only copy of it — so it is reported as `outdated` with its quote intact and a
 * way to remove it, never deleted behind their back.
 *
 * A mark that matches nothing because the DOCUMENT was not rendered at all (a
 * refused read, an unsupported kind) is a different fact and is not this
 * module's business: the caller only reconciles against a real block list.
 */

import type { DocumentAnnotation, MdBlock } from '@/shared/lib/markdown/blocks/types';

export interface ReconcileResult<T extends DocumentAnnotation> {
  /** Marks whose block is on screen, keyed by block key. */
  attached: Map<string, T>;
  /** Marks whose block is no longer rendered, newest first. */
  outdated: T[];
}

/** Attach stored marks to the blocks the render produced. */
export function reconcileAnnotations<T extends DocumentAnnotation>(
  blocks: readonly MdBlock[],
  annotations: readonly T[],
): ReconcileResult<T> {
  const byKey = new Map(blocks.map((block) => [block.key, block]));
  const attached = new Map<string, T>();
  const outdated: T[] = [];

  for (const annotation of annotations) {
    if (byKey.has(annotation.blockKey)) attached.set(annotation.blockKey, annotation);
    else outdated.push(annotation);
  }
  outdated.sort((left, right) => right.updatedAt - left.updatedAt);
  return { attached, outdated };
}

/** The verdict counts the summary chip prints. */
export function tallyAnnotations<T extends DocumentAnnotation>(attached: ReadonlyMap<string, T>): { good: number; needsWork: number } {
  let good = 0;
  let needsWork = 0;
  for (const annotation of attached.values()) {
    if (annotation.verdict === 'good') good += 1;
    else needsWork += 1;
  }
  return { good, needsWork };
}
