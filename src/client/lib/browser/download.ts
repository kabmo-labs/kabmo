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
  saveUrl(url, name);
  URL.revokeObjectURL(url);
}

/**
 * Hand a same-origin URL to the browser as a download named `name`.
 *
 * A native shell cannot download a `blob:` URL — Android's download listener
 * ignores it and the desktop shells never see a navigation — so a file the
 * server can serve is downloaded through this path instead.
 */
export function saveUrl(url: string, name: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
}
