/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The goal strip above the composer.
 *
 * Goal mode outlives a turn: the child re-opens a hidden continuation turn
 * after each `agent_end` until the objective completes, the budget runs out, or
 * the turn ceiling is reached. Without this row the only place that fact lived
 * was the target button in the toolbar's bottom row — a pressed state and a
 * "150k left" chip, neither of which says whether anything is running, how many
 * automatic turns have been spent, or that the loop has stopped.
 *
 * Modelled on a queued-message row (`QueueList`): status word, the objective,
 * its figures, and only the actions that apply right now.
 *
 * ## What the turn counter is, exactly
 *
 * `continuation` comes from the child's own `KABMO_GOAL_CONTINUATION` frame,
 * emitted immediately before it opens an automatic turn — so the run that
 * follows IS the turn it names, and `running` alone would not distinguish a
 * goal turn from an ordinary one the user started. omp exposes no "evaluating"
 * status: verification happens inside the model's turn, so the honest reading is
 * "this turn exists, and the loop opened it".
 *
 * ## Why the destructive action is absent
 *
 * Pause/Resume is the row's only state change: it is what the user reaches for
 * when they see the counter climbing, and it is reversible. Drop lives in the
 * Goal modal, one click away in the same composer — a mode-ending action has no
 * business being a stray click beside Pause.
 */

import { AlertTriangle, CheckCircle2, CircleDot, Loader2, Pause, Play, SlidersHorizontal, Target } from 'lucide-preact';
import type { GoalContinuation, GoalContinuationStop, GoalRecord } from '@/shared/lib/omp/mode/types';
import { formatGoalDuration, formatGoalTokens } from '@/shared/lib/omp/mode/format';
import { isGoalOpen } from '@/shared/lib/omp/mode/status';
import type { GoalAction } from '@/client/hooks/chat/timeline/modes';

/** How each stand-down reason reads, and what the row offers for it. Data, not
 *  a chain of `if`s: the reasons come from two places (the child's ceilings and
 *  Kabmo's auditor) and the row must name every one of them. */
const STOP_UI: Record<GoalContinuationStop, { badge: string; title: string; tone: string; action: 'resume' | 'budget' | 'none' }> = {
  'max-turns': {
    badge: 'stopped',
    title: 'Automatic continuation stopped at the turn ceiling',
    tone: 'text-warning',
    action: 'resume',
  },
  budget: {
    badge: 'budget',
    title: "Automatic continuation stopped: the goal's token budget is spent",
    tone: 'text-warning',
    action: 'budget',
  },
  blocked: {
    badge: 'blocked',
    title: 'The auditor says this goal needs you before more work can help',
    tone: 'text-warning',
    action: 'resume',
  },
  complete: {
    badge: 'done',
    title: 'The auditor judged the objective complete',
    tone: 'text-success',
    action: 'none',
  },
  'audit-failed': {
    badge: 'unchecked',
    title: 'The progress check could not run, so the loop stood down',
    tone: 'text-warning',
    action: 'resume',
  },
};

/** The one-line reason, with the turn count where it is the point. */
function stopChip(stop: GoalContinuationStop, continuation: GoalContinuation): string {
  if (stop === 'max-turns') return `stopped at ${continuation.maxTurns} turns`;
  if (stop === 'budget') return 'budget reached';
  if (stop === 'complete') return 'auditor: complete';
  if (stop === 'blocked') return 'needs you';
  return 'auditor unavailable';
}

export interface GoalBannerProps {
  record: GoalRecord;
  /**
   * The CHAT's run state — the timeline's `timelineRunning`, not the composer's
   * local one. A goal turn driven by another tab or another Kabmo instance is
   * still this goal's turn, and the sidebar spinner already reports it.
   */
  running: boolean;
  /** The child's last automatic turn, or null when it has not reported one. */
  continuation: GoalContinuation | null;
  /** The loop is deciding whether to open another turn (it emits nothing else
   *  for that window, so the spinner covers it). */
  evaluating: boolean;
  /** A mode command is in flight; the row reads as pending rather than absent. */
  pending: boolean;
  onAction: (action: GoalAction) => void;
  onOpenDetails: () => void;
}

/** The first line of the objective. An interview-built objective is a multi-line
 *  markdown document (`# Objective`, `## Success criteria`, …); the full text is
 *  the row's tooltip and the modal's job, and letting it wrap here would push
 *  the transcript around as the goal changes. */
function objectiveSummary(objective: string): string {
  const first = objective.split('\n').map((line) => line.trim()).find((line) => line.length > 0);
  return first ?? 'Untitled goal';
}

export function GoalBanner({ record, running, continuation, evaluating, pending, onAction, onOpenDetails }: GoalBannerProps) {
  if (!isGoalOpen(record.status)) return null;

  const paused = record.status === 'paused';
  const stopReason = continuation?.stopped;
  const stop = stopReason && STOP_UI[stopReason] ? stopReason : null;
  const stopped = !paused && stop !== null;
  // The spinner covers both halves of "not idle": a streaming turn, and the
  // auditor Kabmo runs after it (`goal_evaluating`).
  const busy = running || evaluating;
  const tone = busy ? 'text-ink/45' : stopped ? STOP_UI[stop].tone : paused ? 'text-warning' : 'text-ink/45';
  const badge = paused
    ? 'bg-warning/10 text-warning'
    : stop === 'complete'
      ? 'bg-success/10 text-success'
      : stop
        ? 'bg-warning/10 text-warning'
        : 'bg-ink/8 text-ink/60';

  const tokens =
    record.tokenBudget !== undefined
      ? `${formatGoalTokens(record.tokensUsed)} / ${formatGoalTokens(record.tokenBudget)}`
      : `${formatGoalTokens(record.tokensUsed)} used`;

  return (
    <div
      // The strip sits on the card's own surface — no hairline and no tinted
      // band, so the goal row, the draft and the toolbar read as ONE panel
      // rather than three stacked bars. Its state still shows: the icon and
      // the badge carry the tone (`badge`/`tone`), which is the semantic half;
      // the background was only ever separation.
      className="flex items-center gap-2 px-3 py-1.5 text-[11px]"
      data-goal-banner={record.status}
      data-goal-stop={stop ?? undefined}
    >
      <span
        className={`shrink-0 ${tone}`}
        title={stop ? STOP_UI[stop].title : `Goal is ${record.status}`}
      >
        {busy ? (
          <Loader2 size={12} className="animate-spin" />
        ) : stop === 'complete' ? (
          <CheckCircle2 size={12} />
        ) : paused || stopped ? (
          <AlertTriangle size={12} />
        ) : (
          <Target size={12} />
        )}
      </span>

      <span className={`shrink-0 rounded-full px-1.5 py-px font-mono text-[9.5px] uppercase tracking-wider ${badge}`}>
        {paused ? record.status : stop ? STOP_UI[stop].badge : record.status}
      </span>

      <span className="min-w-0 flex-1 truncate text-ink/75" title={record.objective}>
        {objectiveSummary(record.objective)}
      </span>

      <span className="hidden shrink-0 font-mono text-[10px] text-ink/45 @[560px]:inline" title="Tokens used / budget">
        {tokens}
      </span>
      <span className="hidden shrink-0 font-mono text-[10px] text-ink/45 @[680px]:inline">
        {formatGoalDuration(record.timeUsedSeconds)}
      </span>

      <span aria-live="polite" className={`shrink-0 font-mono text-[10px] ${stopped ? tone : 'text-ink/45'}`}>
        {stop && continuation ? (
          <span title={STOP_UI[stop].title}>{stopChip(stop, continuation)}</span>
        ) : continuation ? (
          <span title="Automatic goal turns taken this session">
            turn {continuation.turn}/{continuation.maxTurns}
          </span>
        ) : evaluating ? (
          <span title="The auditor is checking the turn that just ended">evaluating</span>
        ) : running ? (
          <CircleDot size={11} className="animate-pulse" />
        ) : null}
      </span>

      {stop === 'budget' ? (
        <button
          type="button"
          onClick={onOpenDetails}
          disabled={pending}
          aria-label="Raise the goal budget"
          title="Raise the budget — automatic continuation stopped when it ran out"
          className="flex shrink-0 items-center gap-1 rounded border border-warning/30 px-1.5 py-0.5 text-[10px] text-warning transition-colors hover:bg-warning/10 disabled:opacity-50"
        >
          <SlidersHorizontal size={10} />
          <span className="hidden @[480px]:inline">Raise budget</span>
        </button>
      ) : stop === 'complete' ? null : (
        <button
          type="button"
          onClick={() => onAction(paused || stopped ? { kind: 'resume' } : { kind: 'pause' })}
          disabled={pending}
          aria-label={paused || stopped ? 'Resume the goal' : 'Pause the goal'}
          title={
            paused
              ? 'Resume — the agent continues working toward this goal'
              : stop === 'blocked'
                ? 'Resume — the auditor needs you first; resume once you have unblocked it'
                : stopped
                  ? 'Resume — restart the automatic turn count'
                  : 'Pause — stop automatic continuation after the current turn'
          }
          className={`flex shrink-0 items-center gap-1 rounded border border-ink/15 px-1.5 py-0.5 text-[10px] transition-colors hover:bg-ink/5 disabled:opacity-50 ${
            paused || stopped ? 'text-warning border-warning/30 hover:bg-warning/10' : 'text-ink/70'
          }`}
        >
          {paused || stopped ? <Play size={10} /> : <Pause size={10} />}
          <span className="hidden @[480px]:inline">{paused || stopped ? 'Resume' : 'Pause'}</span>
        </button>
      )}

      <button
        type="button"
        onClick={onOpenDetails}
        aria-label="Goal details"
        title="Objective, tokens, budget and drop"
        className="shrink-0 rounded border border-ink/15 p-1 text-ink/60 transition-colors hover:bg-ink/5"
      >
        <SlidersHorizontal size={11} />
      </button>
    </div>
  );
}
