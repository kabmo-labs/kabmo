/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The strip for a goal that is ARMED but not started.
 *
 * Setting a goal does not start it: the record is created by the fence of the
 * next prompt, so the operator's own words are the goal's first turn. That
 * leaves a state the other two surfaces cannot draw — there is no record yet
 * (`GoalBanner` needs one) and the modal is closed — and the button alone would
 * say "goal on" over nothing running, which is the lie this row prevents.
 *
 * It therefore names what is waiting, says in words what will start it, and
 * offers the one action that applies: disarm. Its frame is deliberately the
 * strip's own (a hairline, dim text), not the active goal's, because nothing is
 * being pursued yet.
 */

import { Target, X } from 'lucide-preact';
import { formatGoalTokens } from '@/shared/lib/omp/mode/format';
import type { ArmedGoal } from '@/shared/lib/omp/mode/actions';

export interface ArmedGoalStripProps {
  goal: ArmedGoal;
  onDisarm: () => void;
}

export function ArmedGoalStrip({ goal, onDisarm }: ArmedGoalStripProps) {
  // The first non-empty line: the modal accepts newlines, and the strip must
  // not grow with them.
  const text = goal.kind === 'guided' ? goal.rough : goal.objective;
  const headline = text.split('\n').map((line) => line.trim()).find((line) => line.length > 0) ?? 'Untitled goal';
  // An armed interview has no limits yet — the objective (and so its budget)
  // does not exist until the model writes it at the end of the conversation.
  const limits = goal.kind === 'guided'
    ? 'interview'
    : [
      goal.tokenBudget === undefined ? 'no budget' : `${formatGoalTokens(goal.tokenBudget)} tokens`,
      goal.maxTurns === undefined ? null : `${goal.maxTurns} turns`,
    ].filter(Boolean).join(' · ');

  return (
    <div
      data-armed-goal
      className="flex items-center gap-2 border-b border-ink/10 px-3 py-1.5 text-[11px] text-ink/70"
    >
      <Target size={11} className="shrink-0 text-ink/45" />
      <span className="shrink-0 rounded bg-ink/8 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink/55">
        {goal.kind === 'guided' ? 'Interview' : 'Armed'}
      </span>
      <span className="min-w-0 flex-1 truncate" title={text}>
        {headline}
      </span>
      <span className="shrink-0 font-mono text-[10px] text-ink/40">{limits}</span>
      <span className="hidden shrink-0 text-ink/45 @[420px]:inline">
        {goal.kind === 'guided' ? 'your next message answers it' : 'starts with your next message'}
      </span>
      <button
        type="button"
        onClick={onDisarm}
        aria-label="Cancel the armed goal"
        title="Cancel the armed goal"
        className="shrink-0 rounded p-0.5 text-ink/40 transition-colors hover:bg-ink/5 hover:text-ink"
      >
        <X size={11} />
      </button>
    </div>
  );
}
