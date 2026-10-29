/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Draw a live screencast frame onto a canvas.
 *
 * The panel used to hand each frame to an `<img src="data:image/jpeg;base64,…">`,
 * and WebKit never releases the decoded image behind a replaced `src`. Measured
 * on this machine (WebKit, 1 760 frames at 16 fps, `footprint` of the WebContent
 * process):
 *
 * | frame sink | footprint |
 * |---|---|
 * | canvas only (no image) | 15 → 29 MB |
 * | `img.src = data URL` | 14 → 148 MB |
 * | `img.src = blob:` (revoked each frame) | 13 → 229 MB |
 * | decoded to an `ImageBitmap`, drawn, closed | 15 → 28 MB |
 *
 * So the sink is a canvas, and the decoded frame is CLOSED as soon as it is
 * painted — the bitmap is the only thing that would hold a full RGBA surface
 * per frame (1 440 × 900 × 4 = 5.2 MB each). A browser tab left on the panel for
 * half an hour receives ~28 800 frames; at the `img` rate that is gigabytes.
 */

/** Base64 (no data-URL prefix) to bytes. */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** A frame's payload as a Blob of its own MIME type, which is what decodes it. */
export function frameBlob(base64: string, mimeType: string): Blob {
  return new Blob([base64ToBytes(base64)], { type: mimeType });
}

/**
 * Paint one frame into `canvas`, closing the decoded bitmap afterwards.
 *
 * Resolves false when the browser cannot decode off-main-thread
 * (`createImageBitmap` is absent) or the payload is malformed — the caller
 * keeps the previous frame rather than blanking the panel.
 */
export async function drawFrame(
  canvas: HTMLCanvasElement,
  base64: string,
  mimeType: string,
): Promise<boolean> {
  const context = canvas.getContext('2d');
  if (!context) return false;
  if (typeof createImageBitmap !== 'function') return false;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(frameBlob(base64, mimeType));
  } catch {
    return false;
  }
  try {
    // The canvas is sized to the frame: the CDP stream's dimensions change with
    // the page's viewport, and a fixed canvas would letterbox or crop it.
    if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
    }
    context.drawImage(bitmap, 0, 0);
    return true;
  } finally {
    bitmap.close();
  }
}
