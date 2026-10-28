/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Turn an editor exception into a toast.
 *
 * The surface reports through `reportEditorError` (see `editor-errors.ts`), and
 * this is the listener half. It is subscribed from `useToasts`, which every toast
 * host already calls — the desktop layout, its left column, the sessions view,
 * the phone's wrapper, the settings modal — so an editor exception cannot be
 * lost by forgetting one call site.
 *
 * ## One event, one toast
 *
 * Several of those hosts are mounted at once, and a `window` event reaches every
 * listener. Measured on the desktop: one report produced THREE toasts. The event
 * object is therefore claimed by the first listener that shows it, and the rest
 * see the claim and stay quiet. Claiming the event (rather than deduplicating by
 * message) is what keeps two genuinely different errors, raised in the same
 * millisecond, both visible.
 */

import { useKabmoEvent } from '@/client/hooks/ui/window-event';
import { EDITOR_ERROR_EVENT } from '@/client/lib/editor-errors';

/** What `pushToast` accepts, named so this hook does not import the toast host. */
type PushToast = (message: string, type?: 'success' | 'error', options?: { duration?: number }) => void;

/** Longer than a normal toast: the message is a bug report, not a confirmation. */
const EDITOR_ERROR_TOAST_MS = 8000;

/** Events already shown by one listener. Weak, so a dispatched event is not retained. */
const claimed = new WeakSet<Event>();

export function useEditorErrorToast(pushToast: PushToast): void {
  useKabmoEvent(EDITOR_ERROR_EVENT, (event) => {
    if (claimed.has(event)) return;
    const message = (event as CustomEvent<{ message?: string }>).detail?.message;
    if (!message) return;
    claimed.add(event);
    // The prefix names the source: the same sentence from a fetch failure would
    // otherwise read as a network problem.
    pushToast(`Editor error: ${message}`, 'error', { duration: EDITOR_ERROR_TOAST_MS });
  });
}
