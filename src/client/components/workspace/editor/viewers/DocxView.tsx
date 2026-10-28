/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A Word document (`.docx`), converted to HTML by mammoth.
 *
 * mammoth is the browser build (`mammoth.browser`), which reads a docx from an
 * `ArrayBuffer` with no Node `fs`: the package's own `browser` field swaps
 * `lib/unzip.js` for `browser/unzip.js`, and the zip work is done by JSZip in
 * the bundle. Verified in Chromium: a docx with headings, bold/italic runs, a
 * list, a table and an embedded image converts to HTML with the image inlined
 * as a `data:` URI.
 *
 * The output is a document's HTML, so it is rendered through the SAME pipeline
 * the markdown preview uses — `sanitizeHtml` is the gate, and it is not
 * optional: mammoth passes a docx's embedded HTML through, and a docx is an
 * untrusted file. Verified in Chromium: DOMPurify strips a `<script>` from the
 * converted HTML while keeping the tables and data-URI images.
 *
 * Read-only by design: there is no mammoth HTML→docx path that round-trips
 * faithfully, so the viewer has no Save and the toolbar hides the write
 * controls for this kind.
 */

import { Loader2 } from 'lucide-preact';
import { useMemo } from 'preact/hooks';
import mammoth from 'mammoth/mammoth.browser.js';
import type { ByteSource } from '@/client/components/workspace/editor/viewers/bytes';
import { useByteDocument } from '@/client/components/workspace/editor/viewers/use-byte-document';
import { ViewerError } from '@/client/components/workspace/editor/viewers/ViewerError';
import { sanitizeHtml } from '@/shared/lib/markdown/sanitize';

interface DocxViewProps {
  source: ByteSource;
  name: string;
  revision?: number;
}

/** Convert a docx's bytes to HTML. Static import: this component is `lazy()`. */
async function convertDocx(bytes: ArrayBuffer): Promise<string> {
  const result = await mammoth.convertToHtml({ arrayBuffer: bytes });
  return result.value;
}

export function DocxView({ source, name, revision = 0 }: DocxViewProps) {
  const { value, loading, error } = useByteDocument(source, convertDocx, revision);

  // Sanitizing on every render would re-parse the document; the HTML is stable
  // per parse, so it is memoized on the raw value.
  const safeHtml = useMemo(() => (value ? sanitizeHtml(value) : ''), [value]);

  if (error) return <ViewerError name={name} message={error} />;
  if (loading || value === null) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-xs text-ink/40">
        <Loader2 size={14} className="animate-spin" />
        <span>Loading document…</span>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto bg-paper">
      <div
        className="prose-content mx-auto max-w-4xl p-6 font-sans"
        dangerouslySetInnerHTML={{ __html: safeHtml }}
      />
    </div>
  );
}
