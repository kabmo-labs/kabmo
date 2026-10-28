/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Browser file actions shared by the editor surfaces. `saveBlob` is the one
 * place that builds and clicks the download anchor, so the text path (a Blob
 * over the buffer) and the image path (a Blob over the fetched bytes) cannot
 * drift apart — the image case has no text buffer at all, which is why it
 * needs the URL variant.
 */

/** Hand `blob` to the browser as a download named `name`. */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * Download a URL's bytes under `name`. Used for images, whose content never
 * reaches the editor buffer — the file is fetched at download time so a large
 * picture is never held in memory just because its tab is open.
 */
export async function downloadUrl(url: string, name: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  saveBlob(await res.blob(), name);
}

/**
 * Put an image on the clipboard as a picture, not as a filename. The async
 * clipboard API is only reachable over HTTPS/localhost and requires the image
 * MIME to be in the browser's clipboard allow-list here — both fail by
 * rejecting, which is the caller's signal that nothing was copied.
 */
export async function copyImageToClipboard(url: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
    throw new Error('Image clipboard unavailable');
  }
  await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
}
