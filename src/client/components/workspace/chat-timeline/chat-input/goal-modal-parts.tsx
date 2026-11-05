/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Goal modal's props, its two field parsers, and its two small rows.
 *
 * Split from `GoalModal.tsx` for the repo's per-file ceiling; the seam is that
 * none of this knows about the dialog's state — the parsers turn one field into
 * a value or a sentence, and the rows are presentational.
 */

import type { ComponentChildren } from 'preact';
import type { GoalRecord } from '@/shared/lib/omp/mode/types';
import type { GoalAction } from '@/shared/lib/omp/mode/actions';
import type { GoalActionResult } from '@/client/hooks/chat/timeline/goal-command';

export interface GoalModalProps {
  open: boolean;
  goal: boolean;
  goalRecord: GoalRecord | null;
  pending: boolean;
  /** The default token budget a NEW goal starts with (Settings → Chats → Goal
   *  Mode). Null means no budget, which is also what an empty field means. */
  defaultBudget?: number | null;
  onClose: () => void;
  /** Resolves with the outcome. The modal closes ITSELF only on success; on a
   *  refusal it stays open with the objective (`error`) so the user can read
   *  the reason and retry — closing on submit threw away what they typed. */
  onSubmit: (action: GoalAction) => Promise<GoalActionResult>;
}

export function parseBudget(raw: string): { value: number | 'off' } | { error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { value: 'off' };
  if (trimmed === 'off') return { value: 'off' };
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return { error: 'Budget must be a positive integer, or `off`.' };
  return { value: parsed };
}

/** An empty field means "whatever this install defaults to" — not zero. */
export function parseMaxTurns(raw: string): { value: number | 'default' } | { error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { value: 'default' };
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return { error: 'Max turns must be a positive integer.' };
  return { value: parsed };
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-ink/10 bg-canvas/30 p-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-ink/40">{label}</div>
      <div className="mt-0.5 truncate font-mono text-[11.5px] text-ink">{value}</div>
    </div>
  );
}

export function ActionButton({
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
