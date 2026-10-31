/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The confirmation a kill gets — the only destructive control in this panel.
 *
 * A process row is 22px tall and the table is dense, so a bare `×` beside it is
 * one mis-click from killing the run the user is reading. This dialog is what
 * stands between them, and it names the process, its pid and what it is holding
 * so the reader can tell whether it is the one they meant.
 *
 * Three behaviours, each a correctness rule rather than polish:
 *
 * - **Cancel is focused first.** Enter on an accidental open must not kill.
 * - **Escape cancels, and Tab stays inside.** A destructive dialog that lets
 *   focus wander into the table behind it is a dialog the keyboard can defeat.
 *   The trap is small on purpose: two buttons.
 * - **The panel's own refusal is shown here, inline.** The server answers
 *   `{ killed: false, reason }` for a pid it will not signal (a stale row, a
 *   foreign process); closing the dialog and dropping the sentence would leave
 *   the user pressing a button that does nothing.
 */

import { useEffect, useRef } from 'preact/hooks';

import { formatBytes } from './format';
import type { ProcessRow } from './snapshot';

export interface KillConfirmProps {
  row: ProcessRow;
  /** The kill call is in flight. */
  pending: boolean;
  /** The server's refusal for this attempt, or a transport error. */
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

const FOCUSABLE = 'button:not([disabled])';

export function KillConfirm({ row, pending, error, onCancel, onConfirm }: KillConfirmProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const targets = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (targets.length === 0) return;
      const first = targets[0];
      const last = targets[targets.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return (
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-ink/35 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="stats-kill-title"
        aria-describedby="stats-kill-body"
        class="w-full max-w-sm flex flex-col gap-3 rounded-lg border border-ink/15 bg-paper p-3 shadow-xl"
      >
        <div class="flex flex-col gap-1">
          <h2 id="stats-kill-title" class="font-sans text-sm font-semibold text-ink">
            Stop pid {row.pid}?
          </h2>
          <p id="stats-kill-body" class="font-sans text-xs text-ink/70">
            {row.title}
            {row.detail ? <span class="block font-mono text-[10px] text-ink/45">{row.detail}</span> : null}
          </p>
        </div>

        <dl class="grid grid-cols-2 gap-1 font-mono text-[10px] text-ink/50">
          <dt>memory</dt>
          <dd class="text-right text-ink/70">
            {formatBytes(row.memory)}
            {row.memorySource === 'footprint' ? ' footprint' : ' rss'}
          </dd>
          <dt>threads</dt>
          <dd class="text-right text-ink/70">{row.threads > 0 ? row.threads : '—'}</dd>
        </dl>

        <p class="font-sans text-[11px] text-ink/60">
          Sends <span class="font-mono">SIGTERM</span>: the process flushes and exits. Work it was running is lost.
          A process that ignores the signal stays in the table — press again to re-send.
        </p>

        {error ? (
          <p role="alert" class="rounded border border-error/30 bg-error/10 px-2 py-1 font-sans text-[11px] text-error">
            {error}
          </p>
        ) : null}

        <div class="flex items-center justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            class="inline-flex items-center px-2.5 py-1.5 text-xs rounded border border-ink/15 text-ink hover:bg-ink/5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            class="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded border border-error/40 bg-error/10 font-semibold text-error transition-colors hover:bg-error/15 disabled:opacity-40 disabled:cursor-default"
          >
            {pending ? 'Stopping…' : 'Stop process'}
          </button>
        </div>
      </div>
    </div>
  );
}