/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Editor exceptions, surfaced instead of swallowed.
 *
 * A `ViewPlugin` that throws does not break the page: CodeMirror catches it and
 * reports it through `EditorView.exceptionSink`, whose default is
 * `console.error`. In a browser console nobody is looking at, that is a feature
 * that silently stopped working — a decoration plugin that throws on every
 * viewport update looks exactly like one that has nothing to draw.
 *
 * ## Deduplicated, because a plugin throws per update
 *
 * The same exception repeats on every keystroke and every scroll. A toast per
 * occurrence would bury the editor it is describing, so one message is reported
 * once per window (`EDITOR_ERROR_WINDOW_MS`) and the rest are dropped.
 *
 * ## A DOM event, not a store
 *
 * The surface is mounted by several owners (the desktop column, the phone's
 * overlay, the diff panel) and the toast host lives in the layout above all of
 * them. An event is the wiring this app already uses for a cross-tree signal
 * (`omp:theme-changed`, `EDITOR_TYPING_CHANGED_EVENT`), and it keeps the editor
 * from importing a layout component.
 */

/** Fired with `{ detail: { message } }` when the editor reports an exception. */
export const EDITOR_ERROR_EVENT = 'kabmo:editor-error';

/** How long one message stays suppressed after being reported. */
export const EDITOR_ERROR_WINDOW_MS = 5000;

/** Message → the timestamp it was last reported at. */
const reported = new Map<string, number>();

/** Test seam: forget every suppression. */
export function resetEditorErrorReports(): void {
  reported.clear();
}

/** The text a thrown value should be shown as. */
function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return 'The editor hit an internal error';
}

/**
 * Report an editor exception to whoever is listening.
 *
 * Returns whether it was actually emitted, so a test can assert the suppression
 * without a DOM.
 */
export function reportEditorError(error: unknown, now = Date.now()): boolean {
  const message = messageOf(error);
  const last = reported.get(message);
  if (last !== undefined && now - last < EDITOR_ERROR_WINDOW_MS) return false;
  reported.set(message, now);
  // A long session must not grow this map by one entry per distinct message.
  if (reported.size > 32) {
    const cutoff = now - EDITOR_ERROR_WINDOW_MS;
    for (const [key, at] of reported) if (at < cutoff) reported.delete(key);
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EDITOR_ERROR_EVENT, { detail: { message } }));
  }
  return true;
}
