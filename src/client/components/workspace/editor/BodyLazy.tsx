/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The editor pane's body, fetched when a document is actually opened.
 *
 * `Body` is where CodeMirror lives — the surface, the diff panel, the document
 * viewers — so importing it statically put `@codemirror/*` in the editor chunk,
 * and the editor column mounts on every console load, with or without a file
 * open. Behind this boundary the column's empty state (`EmptyEditor`, no
 * CodeMirror) is all a console visit pays for; the chunks arrive with the first
 * file.
 *
 * It lives in its own module rather than in `index.tsx` because that file is at
 * the repository's per-file ceiling, and the boundary plus its reason is the
 * one thing here that needs to be read on its own.
 *
 * The fallback is the canvas the body would paint, never a spinner: the tab
 * strip and the pane's frame are already on screen, and a spinner inside them
 * would read as a loading file rather than a loading editor.
 */

import { Suspense, lazy } from 'preact/compat';
import type { EditorBody } from '@/client/components/workspace/editor/Body';

const Body = lazy(() =>
  import('@/client/components/workspace/editor/Body').then((m) => ({ default: m.EditorBody })),
);

type BodyProps = Parameters<typeof EditorBody>[0];

export function BodyLazy(props: BodyProps) {
  return (
    <Suspense fallback={<div className="h-full w-full" />}>
      <Body {...props} />
    </Suspense>
  );
}
