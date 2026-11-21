/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The panel's writes: cancel, re-run, re-run the failed jobs.
 *
 * Two rules, both learned from the forge panel:
 *
 * - **A verb that cannot work is not rendered.** Without a token GitHub refuses
 *   all three, so the row is absent rather than disabled-then-failing; a button
 *   that can only fail teaches a reader to ignore buttons.
 * - **The confirmation names the consequence**, not the click. "Cancel this run?"
 *   asks the reader to remember why; "31 jobs will be stopped" is the fact they
 *   are deciding about. The first press opens the sentence, the second does it —
 *   an inline two-step, so the panel needs no portal to be honest.
 */

import { useState } from 'preact/hooks';

import type { RunVerb } from '../protocol';

export interface Verbs {
  cancel: boolean;
  rerun: boolean;
  rerunFailed: boolean;
}

interface ActionsProps {
  verbs: Verbs;
  /** Why the verbs are missing, when they are. */
  reason: string | null;
  busy: boolean;
  /** Jobs still running, so the cancel sentence can count them. */
  running: number;
  total: number;
  onAct: (verb: RunVerb) => void;
}

const LABELS: Readonly<Record<RunVerb, string>> = {
  cancel: 'Cancel',
  rerun: 'Re-run',
  'rerun-failed': 'Re-run failed',
};

export function Actions({ verbs, reason, busy, running, total, onAct }: ActionsProps) {
  const [pending, setPending] = useState<RunVerb | null>(null);

  const offered: RunVerb[] = [];
  if (verbs.cancel) offered.push('cancel');
  if (verbs.rerun) offered.push('rerun');
  if (verbs.rerunFailed) offered.push('rerun-failed');
  if (offered.length === 0) {
    return reason ? <p class="px-3 py-1.5 text-[11px] text-ink/50">{reason}</p> : null;
  }

  const consequence = (verb: RunVerb): string => {
    if (verb === 'cancel') {
      const count = running > 0 ? running : total;
      return `Cancel this run? ${count} ${count === 1 ? 'job' : 'jobs'} will be stopped.`;
    }
    if (verb === 'rerun') return 'Re-run every job in this run? A new attempt is created.';
    return 'Re-run only the failed jobs and their dependents?';
  };

  return (
    <div class="flex flex-wrap items-center gap-1.5 border-t border-ink/10 px-3 py-1.5">
      {offered.map((verb) =>
        pending === verb ? (
          <span class="flex items-center gap-1.5" data-confirm={verb}>
            <span class="text-[10.5px] text-ink/65">{consequence(verb)}</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setPending(null);
                onAct(verb);
              }}
              class="rounded border border-error-text/40 px-1.5 py-0.5 text-[10.5px] text-error-text hover:bg-error-text/10 disabled:opacity-50"
            >
              Yes, {LABELS[verb].toLowerCase()}
            </button>
            <button
              type="button"
              onClick={() => setPending(null)}
              class="rounded px-1.5 py-0.5 text-[10.5px] text-ink/60 hover:bg-ink/5"
            >
              Keep
            </button>
          </span>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => setPending(verb)}
            class="rounded border border-ink/15 px-1.5 py-0.5 text-[10.5px] text-ink/70 hover:bg-ink/5 disabled:opacity-50"
          >
            {LABELS[verb]}
          </button>
        ),
      )}
    </div>
  );
}
