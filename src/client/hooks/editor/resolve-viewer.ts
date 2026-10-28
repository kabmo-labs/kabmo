/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Resolving a tab's viewer and its bytes.
 *
 * Split from `useFileEditor` for the file ceiling, and it earns the boundary:
 * this is pure derivation from the target, with three rules that each fail
 * silently when wrong and are therefore worth reading in one place.
 *
 * 1. **The viewer comes from the PATH alone.** The pane, the toolbar and the
 *    phone's editor all call `viewerKindFor` on the same string, so they cannot
 *    disagree about which file has a rendered form.
 * 2. **A handle-backed tab has no server path.** Its `path` is only a display
 *    name (see `file-handlers`), so a `/api/fs/raw` URL built from it would
 *    fetch an unrelated file. Its bytes come from the live handle instead.
 * 3. **An image keeps its own URL field** because the image viewer and the
 *    transfer path read `imageUrl`; every other byte viewer takes the source
 *    object.
 */

import { getImageMimeType } from '@/shared/lib/fs/file-kind';
import { BINARY_VIEWERS, viewerKindFor, type ViewerKind } from '@/shared/lib/fs/document-kind';
import { buildFsRawUrl } from '@/shared/lib/fs/paths';
import { byteSourceFor, type ByteSource } from '@/client/components/workspace/editor/viewers/bytes';

/** The minimal target shape this needs — `useFileEditor`'s own target satisfies it. */
export interface ViewerTarget {
  path?: string;
  content?: string;
  root?: string;
  repo?: string;
  handleId?: string;
}

export interface ResolvedViewer {
  viewerKind: ViewerKind;
  isBinaryViewer: boolean;
  isImage: boolean;
  /** Raw-byte URL of the active image (cache-busted per revision), else null. */
  imageUrl: string | null;
  byteSource: ByteSource;
}

export function resolveViewer(target: ViewerTarget | null, revision: number): ResolvedViewer {
  const viewerKind = target ? viewerKindFor(target.path ?? '') : 'code';
  const isBinaryViewer = BINARY_VIEWERS[viewerKind] === true;

  // Rule 2: a handle id means the file has no path the server can reach.
  const hasServerPath = Boolean(target?.path) && !target?.handleId;
  const imageTarget =
    hasServerPath && target?.content === undefined && getImageMimeType(target?.path) ? (target!.path as string) : null;
  const isImage = imageTarget !== null;

  const rawUrl =
    target && !isImage && isBinaryViewer && hasServerPath && target.content === undefined
      ? buildFsRawUrl({ path: target.path as string, root: target.root, repo: target.repo })
      : null;

  const byteSource = byteSourceFor({
    path: target?.path,
    handleId: target?.handleId,
    // An image's URL is cache-busted per revision so a refresh re-decodes the
    // picture; the other byte viewers key their re-read on `revision` directly.
    rawUrl: imageTarget
      ? `${buildFsRawUrl({ path: imageTarget, root: target?.root, repo: target?.repo })}&v=${revision}`
      : rawUrl,
  });

  return {
    viewerKind,
    isBinaryViewer,
    isImage,
    // Rule 3: an image keeps its own URL field.
    imageUrl: isImage ? byteSource.url : null,
    byteSource,
  };
}
