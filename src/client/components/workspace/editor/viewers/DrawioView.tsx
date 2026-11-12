/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A `.drawio` file drawn as the diagram it is.
 *
 * Built on the TEXT buffer, like `SvgPreview`: a drawio file is XML the editor
 * can show and save, so the eye toggle switches between the source and this
 * render with no second fetch, and an edit in the source redraws the picture.
 *
 * The conversion is `@dskripchenko/drawio` (MIT, no runtime dependency, no
 * DOM): it reads both page encodings — inline `<mxGraphModel>` and the
 * base64+deflate one the desktop app saves by default — and emits SVG from the
 * parsed cells. That division is deliberate: the SAFETY argument lives in the
 * library and is covered by its own tests (HTML labels become text runs, colours
 * are validated, `javascript:` links are refused, external images are not
 * loaded unless asked), while this component owns only the parts that are
 * Kabmo's — the page chrome, the multi-page stack, and the report of what could
 * not be drawn.
 *
 * A multi-page file draws every page, stacked, each with its own caption: the
 * alternative is silently showing page one of a five-page document. The
 * renderer's `warnings` are printed for the same reason — a vendor stencil is
 * drawn as a labelled placeholder, and saying so is what keeps the picture from
 * being read as the file's own content.
 *
 * Zoom, pan, fit and the footer controls are `ZoomPanStage`, the same surface an
 * image gets: a diagram and a picture are the same interaction, and a second
 * copy of the fit arithmetic is how the two drift apart.
 */

import { useMemo, useRef } from 'preact/hooks';
import { ViewerError } from '@/client/components/workspace/editor/viewers/ViewerError';
import { renderDrawioPages } from '@/client/components/workspace/editor/viewers/drawio-pages';
import { ZoomPanStage } from '@/client/components/common/zoom-pan-stage';
import { nextSvgScopePrefix } from '@/shared/lib/ui/svg-scope';

interface DrawioViewProps {
  content: string;
  name: string;
}

export function DrawioView({ content, name }: DrawioViewProps) {
  // Allocated once per mounted preview, like `SvgPreview`'s id namespace.
  const scopeRef = useRef('');
  if (!scopeRef.current) scopeRef.current = nextSvgScopePrefix();

  const result = useMemo(() => renderDrawioPages(content, scopeRef.current), [content]);

  if (result.status === 'error') return <ViewerError name={name} message={result.message} />;

  const pages = result.pages;
  const caption =
    pages.length === 1
      ? `${pages[0].name} · ${pages[0].width} × ${pages[0].height} px`
      : `${pages.length} pages · ${pages.map((page) => page.name).join(', ')}`;

  return (
    <ZoomPanStage measureKey={pages} caption={caption}>
      {/* A drawn page is already at its layout size, so the column must not be
          scaled by the browser: the stage transforms it instead. */}
      <div className="flex flex-col items-center gap-6 bg-paper p-6">
        {pages.map((page, index) => (
          <figure key={`${index}-${page.name}`} className="w-max">
            {pages.length > 1 ? (
              <figcaption className="mb-2 text-center font-sans text-[11px] uppercase tracking-wide text-ink/40">
                {page.name}
              </figcaption>
            ) : null}
            {/* The page's own size, so the SVG's `max-width:100%` resolves
                against a definite box instead of a shrink-to-fit parent. */}
            <div
              className="drawio-preview [&>svg]:block"
              role="img"
              aria-label={page.name}
              style={{ width: `${page.width}px`, height: `${page.height}px` }}
              dangerouslySetInnerHTML={{ __html: page.svg }}
            />
            {page.warnings.length > 0 ? (
              <ul className="mx-auto mt-2 max-w-[80ch] space-y-0.5 text-center font-sans text-[10.5px] text-ink/40">
                {page.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
          </figure>
        ))}
      </div>
    </ZoomPanStage>
  );
}
