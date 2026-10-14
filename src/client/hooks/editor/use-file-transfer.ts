/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Getting bytes *out* of an editor tab: copy to the clipboard and download.
 *
 * Split from `useFileEditor` because the paths genuinely differ by kind, and
 * the difference is not cosmetic — it decides WHERE the bytes come from:
 *
 * - text is copied from the in-memory buffer and written to a Blob;
 * - an image is copied as a picture and downloaded from its URL (or its live
 *   handle, for a dropped file);
 * - every other byte viewer (PDF, DOCX, workbook) has NO text buffer at all —
 *   the read is skipped — so a download that fell back to `content` would write
 *   a zero-byte file. It fetches the bytes from the byte source instead.
 */

import { useCallback, useState } from 'preact/hooks';
import { copyImageToClipboard, downloadUrl, saveBlob } from '@/client/hooks/editor/file-actions';
import type { ByteSource } from '@/client/components/workspace/editor/viewers/bytes';

interface FileTransferTarget {
  name: string;
  path?: string;
}

interface UseFileTransferOptions {
  /** The active file, or null when the surface has no tab. */
  target: FileTransferTarget | null;
  /** Current text buffer for `target`; ignored for byte viewers. */
  content: string;
  /** Disk form of `content` (the file's own line endings), used by download. */
  downloadContent: string;
  /** Raw-byte URL of the active image, else null. */
  imageUrl: string | null;
  /** MIME type used for the text Blob. */
  downloadMimeType: string;
  /**
   * Where a byte viewer's bytes come from. Used by download when there is no
   * text buffer (and by an image whose bytes are handle-backed, where
   * `imageUrl` is null).
   */
  byteSource?: ByteSource;
  /** True for a byte viewer, whose download must not use the (empty) buffer. */
  byteViewer?: boolean;
}

export interface UseFileTransferResult {
  /** True for the 1.5s after a successful copy, so the button can confirm it. */
  copied: boolean;
  copy: () => void;
  download: () => void;
}

export function useFileTransfer({
  target,
  content,
  downloadContent,
  imageUrl,
  downloadMimeType,
  byteSource,
  byteViewer = false,
}: UseFileTransferOptions): UseFileTransferResult {
  const [copied, setCopied] = useState(false);

  /** Confirmation flash shared by both copy paths. */
  const flashCopied = useCallback(() => {
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }, []);

  const copy = useCallback(() => {
    if (!target) return;
    // An image goes to the clipboard as a picture. A handle-backed image has no
    // URL until its bytes are read, so it is not offered for copy — the toolbar
    // disables Copy for a byte viewer whose source is not URL-backed.
    if (imageUrl) {
      void copyImageToClipboard(imageUrl).then(flashCopied).catch(() => {});
      return;
    }
    // A non-image byte viewer (PDF, DOCX, workbook) has no text and no picture
    // form: there is nothing to copy, and copying the empty buffer would put an
    // empty string on the clipboard while the button flashed "Copied".
    if (byteViewer) return;
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(content).then(flashCopied).catch(() => {});
  }, [target, content, imageUrl, byteViewer, flashCopied]);

  const download = useCallback(() => {
    if (!target) return;
    // An image's bytes are fetched at download time, so a large picture costs
    // nothing while its tab merely sits open.
    if (imageUrl) {
      void downloadUrl(imageUrl, target.name).catch(() => {});
      return;
    }
    // A byte viewer with no URL (a dropped file): read its bytes and save them.
    if (byteViewer) {
      const load = byteSource?.loadBytes;
      if (!load) return;
      void load()
        .then((bytes) => saveBlob(new Blob([bytes]), target.name))
        .catch(() => {});
      return;
    }
    saveBlob(new Blob([downloadContent], { type: downloadMimeType }), target.name);
  }, [target, downloadContent, downloadMimeType, imageUrl, byteViewer, byteSource]);

  return { copied, copy, download };
}
