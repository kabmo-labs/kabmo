/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The toast queue.
 *
 * ## One queue for the page, not one per host
 *
 * Every surface that could raise a toast used to own a private array and render
 * its own `ToastStack`: the desktop layout, its left column, the chat timeline,
 * the sources panel, the file explorer, four settings panes and both phone
 * shells. Each stack is `fixed bottom-4 right-4`, so two hosts raising a toast at
 * the same time printed two cards in exactly the same place — on the desktop the
 * chat timeline, the left column and the layout are all mounted at once.
 *
 * The queue is therefore module state and there is exactly ONE host
 * (`ToastStack`, mounted by `App`). A host pushes; the single host renders.
 *
 * ## The delay is resolved once, at push
 *
 * `toastDurationMs` decides how long a card lives from its tone and its message
 * length — see `shared/lib/ui/toast-duration.ts` for the measured reason. Keeping
 * the resolution here means every renderer of the same toast draws the same
 * number, and there is one place a caller can override it.
 *
 * ## A repeated sentence is not a second card
 *
 * "Provider list refreshed" on two clicks within a second, or an editor error
 * reported by two plugins, would otherwise stack identical cards. A push whose
 * message and tone already sit in the queue replaces that entry (new id, so its
 * timer starts again) rather than adding a copy beside it.
 */

import { useEffect, useState } from 'preact/hooks';
import type { ToastData } from '@/client/components/common/Toast';
import { toastDurationMs, type ToastTone } from '@/shared/lib/ui/toast-duration';
import { useEditorErrorToast } from '@/client/hooks/ui/editor-error-toast';

/** How many cards may share the corner. Older ones fall off the top. */
const MAX_VISIBLE_TOASTS = 3;

export interface PushToastOptions {
  action?: ToastData['action'];
  /** Auto-dismiss delay in ms; `null` waits for the user. Absent = the policy decides. */
  duration?: number | null;
}

export interface ToastsHandle {
  /** Raise a toast. Stable across renders, so it is safe in an effect's deps. */
  pushToast: (message: string, type?: ToastTone, options?: PushToastOptions) => void;
  /** Drop one toast now, without waiting for its timer. */
  dismissToast: (id: number) => void;
}

let nextId = 1;
let queue: ToastData[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of [...listeners]) listener();
}

export function pushToast(
  message: string,
  type: ToastTone = 'error',
  options: PushToastOptions = {},
): void {
  const text = message.trim();
  // An empty card is noise with no content; a call site that computed an empty
  // sentence is already a bug and should not be given a blank rectangle.
  if (!text) return;
  const duration = toastDurationMs({
    tone: type,
    message: text,
    explicit: options.duration,
    sticky: Boolean(options.action),
  });
  const entry: ToastData = {
    id: nextId,
    message: text,
    type,
    duration,
    ...(options.action ? { action: options.action } : {}),
  };
  nextId += 1;
  const rest = queue.filter(
    (toast) => !(toast.message === text && toast.type === type && !toast.action && !entry.action),
  );
  queue = [...rest, entry].slice(-MAX_VISIBLE_TOASTS);
  emit();
}

export function dismissToast(id: number): void {
  const next = queue.filter((toast) => toast.id !== id);
  if (next.length === queue.length) return;
  queue = next;
  emit();
}

export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The current queue. A new array on every change, so identity means "changed". */
export function getToastsSnapshot(): ToastData[] {
  return queue;
}

/** Drop every toast. Test seam; nothing in the app calls it. */
export function resetToasts(): void {
  if (queue.length === 0) return;
  queue = [];
  emit();
}

/**
 * The push half, and the editor-error listener every host already relied on.
 *
 * Deliberately does NOT subscribe to the queue: this is called from big trees
 * (the chat timeline renders on every streamed frame) and re-rendering one of
 * them because a toast appeared is a cost with no output. The single host reads
 * the queue through `useToastQueue`.
 */
export function useToasts(): ToastsHandle {
  // Every surface that can raise a toast calls this hook — both shells, the
  // sidebar, the settings panes — so subscribing here is what makes an editor
  // exception impossible to miss by forgetting one call site. A CodeMirror
  // plugin that throws is caught by the library and would otherwise reach only
  // the console.
  useEditorErrorToast(pushToast);
  return { pushToast, dismissToast };
}

/** The render half: the queue, re-read on every change. Used by `ToastStack` only. */
export function useToastQueue(): ToastData[] {
  const [toasts, setToasts] = useState<ToastData[]>(getToastsSnapshot);
  useEffect(() => {
    setToasts(getToastsSnapshot());
    return subscribeToasts(() => setToasts(getToastsSnapshot()));
  }, []);
  return toasts;
}
