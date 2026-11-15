/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The one place that builds and clicks a download anchor.
 *
 * Every surface that hands the browser a file — the editor's text and image
 * paths, the pairing QR — goes through here, so the object URL is always
 * released and no caller invents a second anchor.
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
