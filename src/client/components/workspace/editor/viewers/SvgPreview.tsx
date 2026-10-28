/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * An SVG, drawn as the picture it is.
 *
 * The one preview built on the TEXT buffer rather than bytes: an SVG is
 * editable XML (that is why `file-kind` keeps it on the code path), so the eye
 * toggle switches between the source and this render with no second fetch, and
 * an edit in the source updates the picture immediately.
 *
 * The markup is rendered through the SAME `sanitizeMermaidSvg` the mermaid
 * hydrator uses, and for the same reason: an SVG is a document that can carry
 * `<script>` and event handlers, and this one comes from a file the user opened
 * (or an agent wrote). Mermaid's config already allows the shape mermaid emits;
 * here it is applied to arbitrary SVG, so the strict profile is what stops a
 * scripted SVG from running. The result is injected as `innerHTML` inside a
 * container whose size is driven by the SVG's own viewBox.
 */

import { useMemo } from 'preact/hooks';
import { sanitizeMermaidSvg } from '@/shared/lib/markdown/sanitize';

interface SvgPreviewProps {
  content: string;
  name: string;
}

export function SvgPreview({ content, name }: SvgPreviewProps) {
  const safeSvg = useMemo(() => sanitizeMermaidSvg(content), [content]);

  return (
    <div className="flex-1 overflow-auto bg-paper">
      {/* A checkerboard would be wrong here: an SVG is normally opaque or
          intended to sit on a surface, and the panel's paper is that surface.
          The SVG scales to the container via the CSS below rather than a
          measured size, so no layout pass is needed. */}
      <div className="flex min-h-full items-center justify-center p-6">
        <div
          className="svg-preview max-w-full [&>svg]:h-auto [&>svg]:max-h-[80vh] [&>svg]:w-auto [&>svg]:max-w-full"
          role="img"
          aria-label={name}
          dangerouslySetInnerHTML={{ __html: safeSvg }}
        />
      </div>
    </div>
  );
}
