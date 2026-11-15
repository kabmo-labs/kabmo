/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What the composer says when `getUserMedia` refuses the microphone.
 *
 * The reason matters more than the sentence: the three failures a user can act
 * on are a refused permission, a device another app holds, and no device at
 * all — and the fourth case is everything else, which is exactly the case that
 * used to be reported as a bare "Could not open the microphone." with nothing
 * to search for. Android WebView's `NotReadableError` is the one that made this
 * necessary: the app's `RECORD_AUDIO` grant and the page's secure origin were
 * both fine, and the capture still failed one layer below them (Chromium's
 * communication-device selection needs `MODIFY_AUDIO_SETTINGS` in the host
 * manifest). Naming the DOMException is what turns that into a report someone
 * can act on.
 */

/** The sentence the composer shows for a failed capture. */
export function describeCaptureFailure(cause: unknown): string {
  const name = cause instanceof DOMException ? cause.name : '';
  switch (name) {
    case 'NotAllowedError':
      return 'Microphone permission denied.';
    case 'NotReadableError':
      return 'The microphone could not be started — another app may be using it.';
    case 'NotFoundError':
      return 'No microphone was found.';
    default:
      // An unnamed rejection is not a DOMException at all (a thrown string, a
      // missing `AudioContext`), so there is no name to append.
      return name ? `Could not open the microphone (${name}).` : 'Could not open the microphone.';
  }
}
