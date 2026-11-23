/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * An HTML file, drawn as the page it is.
 *
 * Built on the TEXT buffer like `SvgPreview`, so an edit in the source updates
 * the page without a second fetch. The document is handed to a sandboxed
 * `<iframe>` through `srcdoc` rather than injected as `innerHTML`: a page
 * carries its own `<style>`, `<script>` and `<body>` semantics, and putting
 * those in the app's document would let the file restyle — or script — the
 * console around it.
 *
 * `allow-same-origin` is deliberately ABSENT. With it, a script in the file
 * could reach `parent` and this app's storage, which is the isolation the
 * sandbox exists for; without it the frame is an opaque origin. Scripts still
 * run (`allow-scripts`) because a page that builds its own DOM is exactly what
 * the preview is for.
 *
 * Relative references are resolved against the FILE's folder through the same
 * `rewriteDocumentReferences` the markdown preview uses. An `srcdoc` document
 * inherits the PARENT page's base URL, so `./style.css` would otherwise be
 * fetched from the console's own root instead of the file's directory. The
 * rewrite covers `src`/`href` attributes; a CSS `url()` or a script that
 * fetches a relative path is out of its reach, which is a limit of previewing
 * a file that was written to be served by a web server.
 */

import { useMemo } from 'preact/hooks';
import { rewriteDocumentReferences } from '@/shared/lib/markdown/document-urls';

interface HtmlPreviewProps {
  content: string;
  name: string;
  /** The file's path inside its scope, for resolving relative references. */
  path: string;
  root?: string | null;
  repo?: string | null;
}

/**
 * What the page may do. No `allow-same-origin`, so the frame cannot touch this
 * app; `allow-popups` and `allow-downloads` keep an ordinary page's links and
 * downloads working.
 */
const SANDBOX = 'allow-scripts allow-forms allow-modals allow-popups allow-downloads';

export function HtmlPreview({ content, name, path, root = null, repo = null }: HtmlPreviewProps) {
  const html = useMemo(
    () =>
      // A handle-backed or device file has no server-reachable path, so a raw
      // URL built from its display name would fetch an unrelated file. Its
      // markup is shown as written.
      root || repo
        ? rewriteDocumentReferences(content, { path, root: root ?? undefined, repo: repo ?? undefined })
        : content,
    [content, path, root, repo],
  );

  return (
    <iframe
      title={name}
      srcDoc={html}
      sandbox={SANDBOX}
      referrerPolicy="no-referrer"
      className="h-full w-full flex-1 border-0 bg-white"
    />
  );
}
