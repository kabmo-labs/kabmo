/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The hand-off from a CONTENTS row to the rendered preview it describes.
 *
 * A preview is a rendered document: it has no lines and no code surface, so the
 * outline's line request cannot serve it — that request would either do nothing
 * or force the reader out of the document they are reading. In a preview the
 * list is a table of contents, and a row asks for a HEADING.
 *
 * A separate store from `line-reveal` for the same reason `line-reveal` is
 * separate from `search-reveal`: the two requests name different things, are
 * served by different surfaces, and one editor holds both at once (a markdown
 * tab toggles between them). One store would need a mode flag, and a mode flag
 * is how a click ends up applying the wrong one.
 *
 * The request carries the path, so a row clicked for a file that is not the one
 * on screen stays pending instead of scrolling the wrong document.
 */

import type { HeadingRevealTarget } from '@/shared/lib/markdown/headings';

export interface HeadingRevealRequest extends HeadingRevealTarget {
  /** Workspace-relative path of the document whose heading this is. */
  path: string;
}

let pending: HeadingRevealRequest | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of [...listeners]) listener();
}

/** Publish a request; `null` clears it once a preview has served it. */
export function setHeadingReveal(request: HeadingRevealRequest | null): void {
  pending = request;
  emit();
}

/** The pending request, for a consumer that has to re-check after its own render. */
export function getHeadingReveal(): HeadingRevealRequest | null {
  return pending;
}

export function subscribeHeadingReveal(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
