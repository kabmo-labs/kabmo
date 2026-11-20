/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The drag behind the chat column's edge.
 *
 * The column is centred (`margin-inline: auto`, `max-width: var(--chat-column-max)`),
 * so moving its RIGHT edge by a pixel moves the LEFT edge by the same amount:
 * the width changes by TWICE the pointer delta. That factor is measured, not
 * assumed — a drag that used the raw delta moved the edge at half the pointer
 * speed, which reads as a lagging handle (reproduced while building this:
 * pointer 120px right → column 60px wider).
 *
 * The gesture writes the CSS variable itself (via `previewChatColumnWidth`) and
 * stores nothing: only the release commits, so a drag is one settings POST
 * instead of dozens. Nothing is painted while it runs — no guide line, no
 * marker — so applied widths are coalesced to one per frame: the column edge IS
 * the feedback, and the 100ms throttle the panel separator uses (it draws a
 * guide) would visibly drag behind the pointer. One reflow per frame is the
 * cost of that honesty.
 *
 * The drag reads the `.chat-column` beside its handle at `pointerdown` instead
 * of taking a ref: the surfaces that mount the handle (the timeline, the
 * pending chat, a subagent view) each own their own column node, and every one
 * of them resolves through the same `.chat-column` rule the CSS reads.
 */

import { useEffect, useRef } from 'preact/hooks';
import type { TargetedPointerEvent, TargetedKeyboardEvent } from 'preact';
import {
  MAX_CHAT_COLUMN_WIDTH,
  MIN_CHAT_COLUMN_WIDTH,
  resolveChatColumnWidth,
} from '@/shared/lib/chat/timeline/width-mode';
import { commitChatColumnWidth, previewChatColumnWidth, restoreChatColumnWidth } from '@/client/hooks/chat/timeline/width-mode';

/** How far one arrow key moves the edge. One reading-column step: enough to
 *  feel like a resize, small enough to land on a width you meant. */
export const KEYBOARD_STEP_PX = 40;

export interface ColumnDrag {
  onPointerDown: (event: TargetedPointerEvent<HTMLElement>) => void;
  onKeyDown: (event: TargetedKeyboardEvent<HTMLElement>) => void;
}

/**
 * How wide the column MAY become: the content box of its own parent.
 *
 * The column is `width: 100%` under its `max-width`, so a stored value wider
 * than the panel is legal but a drag cannot claim it — the edge would stop
 * following the pointer. Clamped here instead, so the grip tracks the cursor
 * for the whole gesture.
 */
/**
 * The `.chat-column` a handle belongs to.
 *
 * Two mounting shapes exist and both must resolve to a real column: the handle
 * is a SIBLING of the column in the dock frame and in the timeline, and a CHILD
 * of it on the empty workspace's centred landing page. `querySelector` never
 * matches its own element, so the "is my parent the column" case is checked
 * first — without it the landing page's grip dropped the gesture on the floor.
 */
export function chatColumnFor(handle: HTMLElement): HTMLElement | null {
  const host = handle.parentElement;
  if (!host) return null;
  return host.classList.contains('chat-column') ? host : host.querySelector<HTMLElement>('.chat-column');
}

function availableWidth(column: HTMLElement): number {
  const parent = column.parentElement;
  if (!parent) return MAX_CHAT_COLUMN_WIDTH;
  // `getComputedStyle` is the browser's, not a DOM node's — a suite that
  // installs happy-dom's window must install it too, and a non-browser caller
  // gets the box without its padding rather than a `ReferenceError` mid-drag.
  const style = typeof getComputedStyle === 'function' ? getComputedStyle(parent) : null;
  const inset = style
    ? (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0)
    : 0;
  return Math.max(0, Math.floor(parent.clientWidth - inset));
}

export function useColumnDrag(): ColumnDrag {
  const cleanupRef = useRef<(() => void) | null>(null);

  // A drag owns window listeners; a layout switch that unmounts the handle
  // mid-gesture would otherwise leave the body cursor and the listeners behind.
  useEffect(() => () => cleanupRef.current?.(), []);

  const onPointerDown = (event: TargetedPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const column = chatColumnFor(event.currentTarget);
    if (!column) return;

    const rect = column.getBoundingClientRect();
    const max = Math.min(MAX_CHAT_COLUMN_WIDTH, availableWidth(column));
    const min = Math.min(MIN_CHAT_COLUMN_WIDTH, max);
    const startWidth = rect.width;
    const startX = event.clientX;

    event.preventDefault();
    // The pointer leaves the 12px strip the moment the gesture starts, and a
    // `cursor: col-resize` that only applies over the strip would snap back to
    // an arrow mid-drag. `user-select: none` keeps the drag from selecting the
    // transcript text it sweeps across.
    const bodyCursor = document.body.style.cursor;
    const bodySelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    // One pending value and one frame flag: the last pointer position of a
    // frame is the one that is drawn.
    let pending: number | null = null;
    let frame = 0;

    const onMove = (moveEvent: PointerEvent) => {
      // Twice the delta: the column is centred, so both edges move.
      const width = startWidth + 2 * (moveEvent.clientX - startX);
      pending = resolveChatColumnWidth(Math.min(max, Math.max(min, width)));
      if (frame === 0) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          if (pending !== null) previewChatColumnWidth(pending);
        });
      }
    };

    const finish = (commit: boolean) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      if (frame !== 0) cancelAnimationFrame(frame);
      frame = 0;
      cleanupRef.current = null;
      document.body.style.cursor = bodyCursor;
      document.body.style.userSelect = bodySelect;

      // A gesture that moved nothing — a plain click on the grip — stores
      // nothing. `pending` is written by `pointermove` alone, so this is also
      // the branch that keeps a click from pinning the preset to `custom`.
      if (!commit || pending === null) {
        restoreChatColumnWidth();
        return;
      }
      commitChatColumnWidth(pending);
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    cleanupRef.current = () => finish(false);
  };

  const onKeyDown = (event: TargetedKeyboardEvent<HTMLElement>) => {
    const step = event.key === 'ArrowLeft' ? -KEYBOARD_STEP_PX : event.key === 'ArrowRight' ? KEYBOARD_STEP_PX : 0;
    if (step === 0) return;
    const column = chatColumnFor(event.currentTarget);
    if (!column) return;
    event.preventDefault();

    const max = Math.min(MAX_CHAT_COLUMN_WIDTH, availableWidth(column));
    const min = Math.min(MIN_CHAT_COLUMN_WIDTH, max);
    const width = column.getBoundingClientRect().width + 2 * step;
    commitChatColumnWidth(Math.min(max, Math.max(min, width)));
  };

  return { onPointerDown, onKeyDown };
}
