/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Picking and mounting the right viewer for a file.
 *
 * The viewer for a kind is chosen by `viewerKindFor`, and the split that matters
 * here is byte source vs text buffer: a PDF, a DOCX and a workbook read BYTES
 * (fetched from `/api/fs/raw`, or from a dropped file's handle), while a CSV and
 * an SVG read the TEXT buffer — so the grid and the picture are a second view of
 * the same bytes the code surface already has, and the eye toggle switches
 * between them with no second fetch.
 *
 * Every viewer is `lazy()` at MODULE scope, so its library (mammoth,
 * read-excel-file) stays in its own chunk and a session that never opens a
 * document never downloads one. Module scope matters: a `lazy()` created in a
 * render body is a new component type on every render, which remounts the
 * viewer — and the parse — each time.
 */

import { Suspense, lazy } from 'preact/compat';
import { Loader2 } from 'lucide-preact';
import type { ViewerKind } from '@/shared/lib/fs/document-kind';
import type { ByteSource } from '@/client/components/workspace/editor/viewers/bytes';

const PdfView = lazy(() =>
  import('@/client/components/workspace/editor/viewers/PdfView').then((m) => ({ default: m.PdfView })),
);
const DocxView = lazy(() =>
  import('@/client/components/workspace/editor/viewers/DocxView').then((m) => ({ default: m.DocxView })),
);
const SheetView = lazy(() =>
  import('@/client/components/workspace/editor/viewers/SheetView').then((m) => ({ default: m.SheetView })),
);
const CsvGrid = lazy(() =>
  import('@/client/components/workspace/editor/viewers/CsvGrid').then((m) => ({ default: m.CsvGrid })),
);
const SvgPreview = lazy(() =>
  import('@/client/components/workspace/editor/viewers/SvgPreview').then((m) => ({ default: m.SvgPreview })),
);
const ImageView = lazy(() =>
  import('@/client/components/workspace/editor/viewers/ImageView').then((m) => ({ default: m.ImageView })),
);

/** What a viewer is handed: the file's identity, its bytes and its text. */
export interface ViewerProps {
  kind: ViewerKind;
  /** The file's path, for the delimiter sniff and the title. */
  path: string;
  name: string;
  /** Byte source for the byte-drawing viewers. */
  source: ByteSource;
  /** Text buffer, for the viewers that read it (CSV, SVG). */
  content: string;
  /** Bumped to force a re-parse (a workspace refresh). */
  revision: number;
}

/** Whether a file's kind is drawn by a viewer here rather than by the pane. */
export function hasViewerSurface(kind: ViewerKind): boolean {
  return (
    kind === 'image' ||
    kind === 'pdf' ||
    kind === 'docx' ||
    kind === 'spreadsheet' ||
    kind === 'csv' ||
    kind === 'svg'
  );
}

function Loading() {
  return (
    <div className="flex flex-1 items-center justify-center gap-2 text-xs text-ink/40">
      <Loader2 size={14} className="animate-spin" />
      <span>Loading…</span>
    </div>
  );
}

/**
 * The viewer for `kind`, or null when the kind has no rendered surface here
 * (code, markdown and image are each drawn by the pane itself).
 */
export function ViewerSurface({ kind, path, name, source, content, revision }: ViewerProps) {
  if (kind === 'image') {
    return (
      <Suspense fallback={<Loading />}>
        <ImageView source={source} name={name} revision={revision} />
      </Suspense>
    );
  }
  if (kind === 'pdf') {
    return (
      <Suspense fallback={<Loading />}>
        <PdfView source={source} name={name} revision={revision} />
      </Suspense>
    );
  }
  if (kind === 'docx') {
    return (
      <Suspense fallback={<Loading />}>
        <DocxView source={source} name={name} revision={revision} />
      </Suspense>
    );
  }
  if (kind === 'spreadsheet') {
    return (
      <Suspense fallback={<Loading />}>
        <SheetView source={source} name={name} revision={revision} />
      </Suspense>
    );
  }
  if (kind === 'csv') {
    return (
      <Suspense fallback={<Loading />}>
        <CsvGrid content={content} path={path} />
      </Suspense>
    );
  }
  if (kind === 'svg') {
    return (
      <Suspense fallback={<Loading />}>
        <SvgPreview content={content} name={name} />
      </Suspense>
    );
  }
  return null;
}
