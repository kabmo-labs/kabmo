/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A PDF, drawn by the browser's own viewer in an `<iframe>`.
 *
 * The alternative was a JavaScript renderer (pdf.js) and it was measured and
 * rejected: it costs a ~512 KB gzip bundle plus a worker chunk to re-implement
 * scrolling, page navigation, text selection, find, zoom and print that Chrome
 * already ships. The chamber runs in Chromium (and the phone browsers all
 * render PDFs natively), so the native viewer is strictly better here — zero
 * bundle, every affordance, and a rendering path that is not ours to maintain.
 *
 * The `sandbox` attribute is deliberately ABSENT. It would be the reflex, but a
 * sandboxed frame is treated as an opaque origin and Chrome's PDF plugin
 * refuses to initialize in one — the frame renders blank. The URL is
 * same-origin `/api/fs/raw` (or a `blob:` we made ourselves), the bytes are a
 * file the user opened, and the frame has no scripting relationship with this
 * page, so there is nothing a sandbox would be protecting against.
 */

import { Loader2 } from 'lucide-preact';
import type { ByteSource } from '@/client/components/workspace/editor/viewers/bytes';
import { useByteUrl } from '@/client/components/workspace/editor/viewers/use-byte-url';
import { ViewerError } from '@/client/components/workspace/editor/viewers/ViewerError';

interface PdfViewProps {
  source: ByteSource;
  name: string;
  revision?: number;
}

export function PdfView({ source, name, revision = 0 }: PdfViewProps) {
  const { url, loading, error } = useByteUrl(source, revision);

  if (error) return <ViewerError name={name} message={error} />;
  if (loading || !url) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-xs text-ink/40">
        <Loader2 size={14} className="animate-spin" />
        <span>Loading PDF…</span>
      </div>
    );
  }

  return (
    <iframe
      key={url}
      src={url}
      title={name}
      className="h-full w-full flex-1 border-0 bg-paper"
    />
  );
}
