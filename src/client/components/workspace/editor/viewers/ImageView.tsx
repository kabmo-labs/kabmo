/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * An image drawn from a byte source.
 *
 * The desktop and phone editors already paint an image from `imageUrl`, which
 * is `/api/fs/raw` — and that works for a file in a workspace. It does NOT work
 * for a picture the OS handed over (a drop, a launch): that file has no
 * server-reachable path, so its bytes are read through the live handle and
 * wrapped in an object URL here. This is the handle-backed half of the image
 * path; a workspace image still goes straight to `ImageViewer` with its raw URL
 * and never reaches this component.
 */

import { Loader2 } from 'lucide-preact';
import { ImageViewer } from '@/client/components/common/image-viewer';
import type { ByteSource } from '@/client/components/workspace/editor/viewers/bytes';
import { useByteUrl } from '@/client/components/workspace/editor/viewers/use-byte-url';
import { ViewerError } from '@/client/components/workspace/editor/viewers/ViewerError';

interface ImageViewProps {
  source: ByteSource;
  name: string;
  revision?: number;
}

export function ImageView({ source, name, revision = 0 }: ImageViewProps) {
  const { url, loading, error } = useByteUrl(source, revision);

  if (error) return <ViewerError name={name} message={error} />;
  if (loading || !url) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-xs text-ink/40">
        <Loader2 size={14} className="animate-spin" />
        <span>Loading image…</span>
      </div>
    );
  }
  return <ImageViewer src={url} name={name} className="flex-1 min-h-0" />;
}
