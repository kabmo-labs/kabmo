/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The composer's refusal strip: a send that the pipeline rejected, or a
 * mode-command the child answered with an error.
 *
 * Both are the same question and share one row, because a user cannot act on
 * two refusals at once and the strip sits directly above the draft they belong
 * to. Split out of `ChatInput` for the per-file ceiling; it owns no state — the
 * two messages and their two dismissers come from the caller.
 */

import { AlertTriangle, X } from 'lucide-preact';

export interface ComposerNoticeProps {
  /** The pipeline's refusal (unreadable attachment, refused send, …). */
  notice: string | null;
  /** The mode command's refusal, from the route or the extension. */
  modeError?: string | null;
  onDismissNotice: () => void;
  onDismissModeError?: () => void;
}

export function ComposerNotice({
  notice,
  modeError,
  onDismissNotice,
  onDismissModeError,
}: ComposerNoticeProps) {
  const message = notice || modeError;
  if (!message) return null;

  return (
    <div className="flex items-start gap-1.5 bg-error/5 px-3 py-1.5 text-[11px] text-error">
      <AlertTriangle size={11} className="mt-0.5 shrink-0" />
      <span className="min-w-0 flex-1 break-words">{message}</span>
      <button
        type="button"
        onClick={() => (notice ? onDismissNotice() : onDismissModeError?.())}
        className="shrink-0 text-error/60 hover:text-error transition-colors"
        title="Dismiss"
      >
        <X size={11} />
      </button>
    </div>
  );
}
