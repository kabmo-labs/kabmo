/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The write surface: one comment box, and the verbs this item allows.
 *
 * ## Every verb is a CONFIRMED action, and the dialog names the consequence
 *
 * "Merge" is one word and an irreversible change to a branch everyone shares, so
 * the confirmation states what will happen — the method, the branch pair, that
 * the source branch may be deleted — rather than asking "are you sure?". The same
 * for close and for request-changes: a dialog that only asks whether the reader
 * meant to click teaches them to click through it.
 *
 * ## The buttons come from the SERVER's capability table
 *
 * `detail.capabilities` is computed per read from the provider, the section and
 * whether a credential exists. A public repository read anonymously therefore
 * offers nothing, and the panel does not have to guess — a button that can only
 * fail is worse than no button, and a second copy of the rules here would drift
 * from the one the server enforces.
 *
 * ## A refusal is reported where the action was
 *
 * The server's sentence ("GitLab has no request-changes event…") lands in the
 * strip above the box, not in a toast: it names what is missing from THIS action,
 * and a message that scrolls away is one the reader has to reproduce.
 */

import { useState } from 'preact/hooks';

import type { ForgeCapabilities, ForgeCredential, ForgeDetail, ForgeItem, ForgeWrite } from '../protocol';
import type { ForgeWriteState } from './use-forge';
import { Glyph, ICON } from './Glyph';

interface WriteProps {
  item: ForgeItem;
  detail: ForgeDetail | null;
  capabilities: ForgeCapabilities | null;
  write: ForgeWriteState;
  /** Which credential the server resolved. Absent when it could not be read. */
  credential?: ForgeCredential;
}

/** Which dialog is open, if any. */
type Pending = 'close' | 'reopen' | 'approve' | 'request_changes' | 'merge' | null;

const MERGE_METHODS: Array<{ value: 'merge' | 'squash' | 'rebase'; label: string; hint: string }> = [
  { value: 'merge', label: 'Merge commit', hint: 'Keeps every commit and adds a merge commit.' },
  { value: 'squash', label: 'Squash', hint: 'One commit on the target branch; the branch history is not kept.' },
  { value: 'rebase', label: 'Rebase', hint: 'Replays the commits onto the target, with no merge commit.' },
];

/** The sentence a confirmation shows before an irreversible verb runs. */
export function consequence(item: ForgeItem, pending: Pending, method: 'merge' | 'squash' | 'rebase'): string {
  if (pending === 'merge') {
    const chosen = MERGE_METHODS.find((entry) => entry.value === method);
    return `Merge ${item.number !== null ? `#${item.number}` : item.title} into its target branch with "${chosen?.label ?? method}". ${chosen?.hint ?? ''}`;
  }
  if (pending === 'close') return `Close ${item.number !== null ? `#${item.number}` : item.title}. It stays readable and can be reopened.`;
  if (pending === 'reopen') return `Reopen ${item.number !== null ? `#${item.number}` : item.title}.`;
  if (pending === 'approve') return 'Approve this change. It counts as a review in the host’s own rules.';
  if (pending === 'request_changes') return 'Request changes. The author is notified and the review blocks a merge where the host enforces it.';
  return '';
}

export function WriteBar({ item, detail, capabilities, write }: WriteProps) {
  const [body, setBody] = useState('');
  const [pending, setPending] = useState<Pending>(null);
  const [method, setMethod] = useState<'merge' | 'squash' | 'rebase'>('merge');

  const caps = capabilities;
  const anyVerb = caps ? caps.comment || caps.state || caps.review || caps.merge : false;
  const closed = item.state === 'closed' || item.state === 'merged';
  /** How the item is named in a button's accessible name. */
  const label = item.number !== null ? `#${item.number}` : item.title;

  const submitComment = async () => {
    const text = body.trim();
    if (!text) return;
    const ok = await write.run({ kind: 'comment', body: text });
    if (ok) setBody('');
  };

  const confirm = async () => {
    if (!pending) return;
    const intent: ForgeWrite | null =
      pending === 'close'
        ? { kind: 'state', state: 'closed' }
        : pending === 'reopen'
          ? { kind: 'state', state: 'open' }
          : pending === 'merge'
            ? { kind: 'merge', method }
            : pending === 'approve'
              ? { kind: 'review', verdict: 'approve', body: body.trim() }
              : { kind: 'review', verdict: 'request_changes', body: body.trim() };
    setPending(null);
    const ok = intent ? await write.run(intent) : false;
    if (ok && (pending === 'approve' || pending === 'request_changes')) setBody('');
  };

  if (!anyVerb && !detail?.capabilities) {
    // A repository read without a credential: the reason is the server's own
    // note, which the detail already carries above the body.
    return null;
  }

  return (
    <div className="flex flex-shrink-0 flex-col gap-1.5 border-t border-ink/10 px-2.5 py-1.5">
      {caps?.comment && (
        <div className="flex flex-col gap-1">
          <textarea
            value={body}
            onInput={(event) => setBody(event.currentTarget.value)}
            placeholder="Add a comment…"
            aria-label="Comment"
            rows={2}
            className="w-full resize-y rounded border border-ink/15 bg-canvas px-2 py-1.5 text-[11px] text-ink outline-none placeholder-ink/35 focus:border-ink/40"
          />
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => void submitComment()}
              disabled={write.pending || body.trim().length === 0}
              aria-label={`Post a comment on ${label}`}
              className="rounded border border-ink/15 px-2 py-1 text-[10px] text-ink transition-colors hover:bg-ink/5 disabled:opacity-40"
            >
              Comment
            </button>

            {caps.review && !closed && (
              <>
                <button
                  type="button"
                  onClick={() => setPending('approve')}
                  disabled={write.pending}
                  aria-label={`Approve ${label}`}
                  className="rounded border border-ink/15 px-2 py-1 text-[10px] text-ink transition-colors hover:bg-ink/5 disabled:opacity-40"
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => setPending('request_changes')}
                  disabled={write.pending}
                  aria-label={`Request changes on ${label}`}
                  className="rounded border border-ink/15 px-2 py-1 text-[10px] text-ink transition-colors hover:bg-ink/5 disabled:opacity-40"
                >
                  Request changes
                </button>
              </>
            )}

            {caps.merge && !closed && (
              <button
                type="button"
                onClick={() => setPending('merge')}
                disabled={write.pending}
                aria-label={`Merge ${label}`}
                className="ml-auto flex items-center gap-1 rounded border border-ink/15 px-2 py-1 text-[10px] text-ink transition-colors hover:bg-ink/5 disabled:opacity-40"
              >
                <Glyph path={ICON.merge} size={10} />
                Merge
              </button>
            )}

            {/*
              The accessible name carries the ITEM (`Close #12`), because the
              bare word collides with the header's `Closed` filter: two controls
              whose names differ by a letter are ambiguous to a screen reader and
              to anything else that addresses a control by name.
            */}
            {caps.state && (
              <button
                type="button"
                onClick={() => setPending(closed ? 'reopen' : 'close')}
                disabled={write.pending}
                aria-label={`${closed ? 'Reopen' : 'Close'} ${label}`}
                className={`${caps.merge && !closed ? '' : 'ml-auto'} rounded border border-ink/15 px-2 py-1 text-[10px] text-ink transition-colors hover:bg-ink/5 disabled:opacity-40`}
              >
                {closed ? 'Reopen' : 'Close'}
              </button>
            )}
          </div>
        </div>
      )}

      {write.error && <p className="text-[10.5px] text-error">{write.error}</p>}
      {write.notice && <p className="text-[10.5px] text-success">{write.notice}</p>}

      {pending && (
        <div className="rounded border border-ink/20 bg-canvas p-2">
          <p className="text-[11px] leading-snug text-ink">{consequence(item, pending, method)}</p>
          {pending === 'merge' && (
            <div className="mt-1.5 flex flex-col gap-0.5">
              {MERGE_METHODS.map((entry) => (
                <label key={entry.value} className="flex items-start gap-1.5 text-[10.5px] text-ink/80">
                  <input
                    type="radio"
                    name="forge-merge-method"
                    checked={method === entry.value}
                    onChange={() => setMethod(entry.value)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium text-ink">{entry.label}</span>
                    <span className="text-ink/50"> — {entry.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
          <div className="mt-1.5 flex items-center gap-1">
            <button
              type="button"
              onClick={() => void confirm()}
              disabled={write.pending}
              className="rounded bg-ink px-2 py-1 text-[10px] text-canvas transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {pending === 'merge' ? 'Merge' : pending === 'close' ? 'Close' : pending === 'reopen' ? 'Reopen' : pending === 'approve' ? 'Approve' : 'Request changes'}
            </button>
            <button
              type="button"
              onClick={() => setPending(null)}
              className="rounded px-2 py-1 text-[10px] text-ink/60 hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
