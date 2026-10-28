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

import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { Target, X } from 'lucide-preact';
import type { GoalRecord } from '@/shared/lib/omp/mode/types';
import type { GoalAction } from '@/client/hooks/chat/timeline/modes';

export interface GoalModalProps {
  open: boolean;
  goal: boolean;
  goalRecord: GoalRecord | null;
  pending: boolean;
  /** The default token budget a NEW goal starts with (Settings → Chats → Goal
   *  Mode). Null means no budget, which is also what an empty field means. */
  defaultBudget?: number | null;
  onClose: () => void;
  onSubmit: (action: GoalAction) => void;
}

function parseBudget(raw: string): { value: number | 'off' } | { error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { value: 'off' };
  if (trimmed === 'off') return { value: 'off' };
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return { error: 'Budget must be a positive integer, or `off`.' };
  return { value: parsed };
}

/** An empty field means "whatever this install defaults to" — not zero. */
function parseMaxTurns(raw: string): { value: number | 'default' } | { error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { value: 'default' };
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return { error: 'Max turns must be a positive integer.' };
  return { value: parsed };
}

export function GoalModal({ open, goal, goalRecord, pending, defaultBudget = null, onClose, onSubmit }: GoalModalProps) {
  const [objective, setObjective] = useState('');
  const [budget, setBudget] = useState('');
  const [maxTurns, setMaxTurns] = useState('');
  const [guided, setGuided] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const submitCreate = () => {
    if (guided) {
      onSubmit({ kind: 'guided', rough: objective.trim() });
      onClose();
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
    onSubmit({
      kind: 'create',
      objective: objective.trim(),
      ...(parsed.value === 'off' ? {} : { tokenBudget: parsed.value }),
      ...(turns.value === 'default' ? {} : { maxTurns: turns.value }),
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/30 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-ink/15 bg-paper shadow-xl"
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
                <ActionButton onClick={() => { onSubmit({ kind: 'resume' }); onClose(); }} disabled={pending}>
                  Resume
                </ActionButton>
              ) : (
                <ActionButton onClick={() => { onSubmit({ kind: 'pause' }); onClose(); }} disabled={pending}>
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
                  onSubmit({ kind: 'budget', value: parsed.value });
                  onClose();
                }}
                disabled={pending}
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
                onClick={() => { onSubmit({ kind: 'drop' }); onClose(); }}
                disabled={pending}
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
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-ink/45">
                  Token budget
                </label>
                <input
                  value={budget}
                  onChange={(event) => setBudget(event.currentTarget.value)}
                  placeholder="optional — e.g. 200000, or off"
                  aria-label="Token budget"
                  className="w-full rounded-lg border border-ink/15 bg-paper px-3 py-1.5 font-mono text-[11.5px] outline-none focus:border-ink"
                />
                {defaultBudget !== null && (
                  <p className="mt-1 text-[10px] text-ink/45">
                    Prefilled from Settings → Chats → Goal Mode; clear it for no budget.
                  </p>
                )}
              </div>
              <div className="flex-1">
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-ink/45">
                  Max turns
                </label>
                <input
                  value={maxTurns}
                  onChange={(event) => setMaxTurns(event.currentTarget.value)}
                  placeholder="auto — this install's default"
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
                className="mt-0.5"
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
                disabled={pending}
                className="rounded bg-ink px-3 py-1.5 text-[11.5px] text-canvas transition-colors hover:bg-ink/80 disabled:opacity-50"
              >
                {guided ? 'Start interview' : 'Start goal'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-ink/10 bg-canvas/30 p-2">
      <div className="text-[9.5px] font-semibold uppercase tracking-wider text-ink/40">{label}</div>
      <div className="mt-0.5 truncate font-mono text-[11.5px] text-ink">{value}</div>
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
}: {
  children: ComponentChildren;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded border border-ink/20 px-3 py-1.5 text-[11px] text-ink transition-colors hover:bg-ink/5 disabled:opacity-50"
    >
      {children}
    </button>
  );
}
