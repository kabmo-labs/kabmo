/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Goal modal: set an objective, or manage the one that is running.
 *
 * Three shapes, chosen by the goal's own status:
 *
 *  - **off** — objective + optional token budget, with a "let the agent
 *    interview me" switch. The interview path sends omp's own
 *    `guided-goal-interview` kickoff, so the model asks its questions in the
 *    ordinary chat and closes by creating the goal itself.
 *  - **on** — the live record (status, tokens against budget, time), with
 *    Pause / Resume / Adjust budget / Drop.
 *  - **pending** — the create request is in flight.
 *
 * The budget field is deliberately free-text with its own validation rather
 * than a number input: `off` is a valid answer (no cap), and omp's own setting
 * accepts the same vocabulary.
 */

import { CHECKBOX_CLASS } from '@/client/components/common/checkbox/style';
import { useEffect, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { Target, X } from 'lucide-preact';
import type { GoalAction } from '@/shared/lib/omp/mode/actions';
import {
  ActionButton,
  Stat,
  parseBudget,
  parseMaxTurns,
  type GoalModalProps,
} from '@/client/components/workspace/chat-timeline/chat-input/goal-modal-parts';

export type { GoalModalProps };

export function GoalModal({ open, goal, goalRecord, pending, defaultBudget = null, onClose, onSubmit }: GoalModalProps) {
  const [objective, setObjective] = useState('');
  const [budget, setBudget] = useState('');
  const [maxTurns, setMaxTurns] = useState('');
  const [guided, setGuided] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** True while the submitted command is in flight: the buttons read as busy
   *  instead of accepting a second click for the same goal. */
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // A fresh open starts from a blank form: a previous objective left behind
  // would be submitted as the new one by a careless Enter. The budget field
  // starts from the install's default (Settings → Chats → Goal Mode) rather
  // than blank, so the number a goal is created with is visible before the
  // create — and clearing it is still how you ask for no budget.
  useEffect(() => {
    if (!open) return;
    setObjective('');
    setBudget(defaultBudget === null ? '' : String(defaultBudget));
    setMaxTurns('');
    setGuided(false);
    setError(null);
    textareaRef.current?.focus();
  }, [open, defaultBudget]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  // One submit path for every action: await the outcome, close only on success.
  // A refusal leaves the form (and whatever was typed) exactly where it was, with
  // the reason under the fields — the previous version closed first and then
  // dropped the objective, which is what made a refusal read as a dead button.
  const busy = pending || submitting;
  const submit = async (action: GoalAction): Promise<void> => {
    setError(null);
    setSubmitting(true);
    try {
      const result = await onSubmit(action);
      if (result.ok) onClose();
      else setError(result.error ?? 'The goal command was refused.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The goal command was refused.');
    } finally {
      setSubmitting(false);
    }
  };

  const submitCreate = (): void => {
    if (guided) {
      void submit({ kind: 'guided', rough: objective.trim() });
      return;
    }
    if (!objective.trim()) {
      setError('An objective is required.');
      return;
    }
    const parsed = parseBudget(budget);
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }
    const turns = parseMaxTurns(maxTurns);
    if ('error' in turns) {
      setError(turns.error);
      return;
    }
    void submit({
      kind: 'create',
      objective: objective.trim(),
      ...(parsed.value === 'off' ? {} : { tokenBudget: parsed.value }),
      ...(turns.value === 'default' ? {} : { maxTurns: turns.value }),
    });
  };

  // PORTALLED to `<body>`, and that is what centres it.
  //
  // The modal is mounted from the composer's `header` slot, and a `fixed`
  // element is contained by any ancestor that is a containing block. Measured
  // in Chromium at 1440x900 by re-parenting the real scrim into the composer
  // card: the scrim went from `1440x900` at `(0,0)` — the viewport — to
  // `710x164` at the CARD's box, i.e. exactly the `@container` composer, and the
  // dialog centred on it (dx -49, dy +38). Reproduced by any of the three
  // properties the composer can carry: `backdrop-filter` (the `glass` style's
  // `--glass-card-filter`), a `transform`, or `contain: layout`. `container-type`
  // alone did NOT trigger it, so an earlier note here blaming containment was
  // wrong.
  //
  // The effect is what the operator sees as "the goal modal opens in front of
  // the composer" instead of the middle of the screen. A portal escapes every
  // such ancestor; the same reason `Toast`, `anchored-menu` and `diagram-viewer`
  // portal.
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center modal-scrim p-4" onClick={onClose}>
      <div
        className="glass-overlay w-full max-w-lg overflow-hidden rounded-xl border border-ink/15 bg-paper shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-ink/10 px-4 py-3">
          <div className="flex items-center gap-2">
            <Target size={14} className="text-ink/60" />
            <span className="text-sm font-medium">{goal ? 'Goal mode' : 'Start a goal'}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-ink/50 transition-colors hover:bg-ink/5 hover:text-ink"
          >
            <X size={14} />
          </button>
        </div>

        {goal && goalRecord ? (
          <div className="space-y-3 p-4 text-xs">
            <div className="rounded-lg border border-ink/10 bg-canvas/40 p-3">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink/45">Objective</div>
              <div className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink">{goalRecord.objective}</div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Status" value={goalRecord.status} />
              <Stat
                label="Tokens"
                value={
                  goalRecord.tokenBudget !== undefined
                    ? `${goalRecord.tokensUsed.toLocaleString()} / ${goalRecord.tokenBudget.toLocaleString()}`
                    : goalRecord.tokensUsed.toLocaleString()
                }
              />
              <Stat label="Time" value={`${Math.round(goalRecord.timeUsedSeconds / 60)}m`} />
            </div>
            {error && <div className="text-error">{error}</div>}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {goalRecord.status === 'paused' ? (
                <ActionButton onClick={() => void submit({ kind: 'resume' })} disabled={busy}>
                  Resume
                </ActionButton>
              ) : (
                <ActionButton onClick={() => void submit({ kind: 'pause' })} disabled={busy}>
                  Pause
                </ActionButton>
              )}
              <ActionButton
                onClick={() => {
                  const parsed = parseBudget(budget);
                  if ('error' in parsed) {
                    setError(parsed.error);
                    return;
                  }
                  void submit({ kind: 'budget', value: parsed.value });
                }}
                disabled={busy}
              >
                Set budget
              </ActionButton>
              <input
                value={budget}
                onChange={(event) => setBudget(event.currentTarget.value)}
                placeholder="e.g. 200000 or off"
                className="w-40 rounded border border-ink/15 bg-paper px-2 py-1.5 font-mono text-[11px] outline-none focus:border-ink"
              />
              <button
                type="button"
                onClick={() => void submit({ kind: 'drop' })}
                disabled={busy}
                className="ml-auto rounded border border-error/40 px-3 py-1.5 text-[11px] text-error transition-colors hover:bg-error/10 disabled:opacity-50"
              >
                Drop goal
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3 p-4">
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-ink/45">
                Objective
              </label>
              <textarea
                ref={textareaRef}
                value={objective}
                onChange={(event) => setObjective(event.currentTarget.value)}
                rows={4}
                placeholder="Migrate the importer to streaming. Update every caller, preserve error behaviour, and finish only after the importer tests and typecheck pass."
                className="w-full resize-y rounded-lg border border-ink/15 bg-paper px-3 py-2 text-[12.5px] leading-relaxed outline-none focus:border-ink"
              />
              <p className="mt-1 text-[10.5px] text-ink/45">
                Name the deliverables, the evidence of completion, and any prohibited shortcuts.
              </p>
            </div>
            {/* `min-w-0` on both halves: a flex item defaults to
                `min-width: auto`, so the two fields kept their intrinsic input
                width and overflowed a phone's 358px card (measured: "auto: this
                install'" and "2000" clipped mid-word). */}
            <div className="flex items-end gap-3">
              <div className="min-w-0 flex-1">
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-ink/45">
                  Token budget
                </label>
                <input
                  value={budget}
                  onChange={(event) => setBudget(event.currentTarget.value)}
                  placeholder="e.g. 200000"
                  aria-label="Token budget"
                  className="w-full rounded-lg border border-ink/15 bg-paper px-3 py-1.5 font-mono text-[11.5px] outline-none focus:border-ink"
                />
                {defaultBudget !== null && (
                  <p className="mt-1 text-[10px] text-ink/45">
                    Prefilled from Settings → Chats → Goal Mode; clear it for no budget.
                  </p>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-ink/45">
                  Max turns
                </label>
                <input
                  value={maxTurns}
                  onChange={(event) => setMaxTurns(event.currentTarget.value)}
                  placeholder="install default"
                  inputMode="numeric"
                  aria-label="Max automatic turns"
                  className="w-full rounded-lg border border-ink/15 bg-paper px-3 py-1.5 font-mono text-[11.5px] outline-none focus:border-ink"
                />
                <p className="mt-1 text-[10px] text-ink/45">
                  Automatic continuations before the loop stops itself. The auditor can end it sooner; this is the hard stop.
                </p>
              </div>
            </div>
            <label className="flex items-start gap-2 text-[11.5px] text-ink/75">
              <input
                type="checkbox"
                checked={guided}
                onChange={(event) => setGuided(event.currentTarget.checked)}
                className={`${CHECKBOX_CLASS} mt-0.5`}
              />
              <span>
                Let the agent interview me first — it asks one question per turn, then writes the objective itself.
              </span>
            </label>
            {error && <div className="text-[11.5px] text-error">{error}</div>}
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="rounded px-3 py-1.5 text-[11.5px] text-ink/70 transition-colors hover:bg-ink/5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitCreate}
                disabled={busy}
                className="rounded bg-ink px-3 py-1.5 text-[11.5px] text-canvas transition-colors hover:bg-ink/80 disabled:opacity-50"
              >
                {guided ? 'Start interview' : 'Start goal'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
