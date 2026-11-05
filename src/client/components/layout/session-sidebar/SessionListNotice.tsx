/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What the session list says when the read FAILED.
 *
 * The list used to have two states: `initializing` (skeleton) and data. A failed
 * read therefore looked exactly like a slow one, forever — measured with `/api/**`
 * aborted, the drawer still drew placeholders after seven seconds, with no text,
 * no `role="alert"` and no control to retry. R-27 asks for the third state and
 * asks it to name the cause and the next action, which is what this draws.
 *
 * Two audiences, one component: the desktop dock and the phone's drawer both get
 * it from here, so the two layouts cannot word the same failure differently. It
 * is deliberately NOT a skeleton with an error tint: the shape that means "still
 * coming" must not be the shape that means "this is not coming".
 */

import { AlertTriangle, RefreshCw } from 'lucide-preact';

interface SessionListNoticeProps {
  /** `touch` is the phone drawer: taller targets, roomier text. */
  touch?: boolean;
  /** The user's own retry — the same `refreshNow` the toolbar's button calls. */
  onRetry: () => void;
}

export function SessionListNotice({ touch = false, onRetry }: SessionListNoticeProps) {
  return (
    <div
      role="alert"
      className={`flex flex-col items-center justify-center gap-2 px-4 text-center ${touch ? 'py-10' : 'py-8'}`}
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-md border border-ink/10 bg-ink/5 text-muted">
        <AlertTriangle size={15} aria-hidden="true" />
      </span>
      <p className="text-xs font-semibold text-ink">The session list could not be loaded.</p>
      <p className={`text-muted leading-relaxed ${touch ? 'text-xs' : 'text-[11px]'}`}>
        The live connection closed before the first reply arrived. Your sessions are still on
        disk; they are not shown here because this tab never received them.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className={`mt-1 inline-flex items-center gap-1.5 rounded-md border border-ink/20 bg-paper px-2.5 font-medium text-ink transition-colors hover:bg-ink/5 ${
          touch ? 'h-11 text-sm' : 'h-7 text-xs'
        }`}
      >
        <RefreshCw size={13} aria-hidden="true" />
        Try again
      </button>
    </div>
  );
}
