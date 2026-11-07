/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Plan and Goal mode toggles for the composer toolbar.
 *
 * Two icon-only buttons beside the access selector. They are pressed states,
 * not menus: `aria-pressed` carries the mode, the `title` and `aria-label` name
 * it (a bare `<svg onClick>` is unreachable by keyboard and unreadable to a
 * screen reader — the rule the editor and diff toolbars already follow).
 *
 * ## Why the strip is a container query
 *
 * The composer sits in a chat panel that can be 320px wide on a 1440px screen,
 * so viewport breakpoints are the wrong axis: `sm:` would keep every label on
 * and overflow the panel. Each button therefore hides its LABEL below
 * `@[420px]` and keeps the icon, which is what the diff toolbar learned when a
 * 361px action strip overflowed a 296px box with no scrollbar to say so.
 *
 * ## Why Goal opens a modal
 *
 * Plan mode is a boolean: on means "explore before editing". Goal mode is not —
 * it needs an objective and, optionally, a token budget, and omp refuses
 * `createGoal` without an objective. So the Goal button opens `GoalModal` when
 * it is off, and offers pause/resume/drop when it is on.
 */

import { ClipboardList, Target } from 'lucide-preact';
import type { GoalRecord } from '@/shared/lib/omp/mode/types';
import type { ArmedGoal } from '@/shared/lib/omp/mode/actions';

export interface ModeTogglesProps {
  plan: boolean;
  goal: boolean;
  /** A goal set but not started: the next message is its first turn. */
  goalArm: ArmedGoal | null;
  goalRecord: GoalRecord | null;
  /** A mode command is in flight; the buttons stay responsive but read as
   *  pending so a slow child cannot look like a dead button. */
  pending: boolean;
  onTogglePlan: (enabled: boolean) => void;
  onOpenGoal: () => void;
  /** Whether Plan is offered at all. Hidden while Goal is on: omp refuses to
   *  enter one mode while the other is active, so offering both would present a
   *  button whose only outcome is an error. */
  planAvailable: boolean;
  /** Whether Goal is offered at all: a non-omp ACP agent has no `/kabmo-mode`
   *  extension, so the button could only produce a refusal. */
  goalAvailable: boolean;
}

/** omp's own footer shows goal token usage beside the mode indicator; that
 *  figure now lives in the goal strip above the composer (`GoalBanner`), where
 *  it has room for the budget, the time and the turn count. Keeping a second
 *  copy here meant two spellings of the same number in a 320px panel. */
function goalTitle(goal: boolean, record: GoalRecord | null): string {
  if (!goal) return 'Goal mode: off — click to set an objective';
  if (!record) return 'Goal mode: on';
  const used = record.tokensUsed.toLocaleString();
  const budget = record.tokenBudget !== undefined ? ` / ${record.tokenBudget.toLocaleString()}` : '';
  return `Goal: ${record.status} — ${used}${budget} tokens. Click to manage.`;
}

export function ModeToggles({
  plan,
  goal,
  goalArm,
  goalRecord,
  pending,
  onTogglePlan,
  onOpenGoal,
  planAvailable,
  goalAvailable,
}: ModeTogglesProps) {
  return (
    <div className="flex items-center gap-0.5">
      {planAvailable && (
        <button
          type="button"
          onClick={() => onTogglePlan(!plan)}
          aria-pressed={plan}
          aria-label={plan ? 'Leave plan mode' : 'Enter plan mode'}
          title={plan ? 'Plan mode is on — the agent explores before editing' : 'Plan mode: explore and draft before any edit'}
          className={`tap-chip flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors cursor-pointer ${
            plan ? 'bg-ink text-canvas' : 'text-muted hover:bg-ink/5'
          } ${pending ? 'opacity-60' : ''}`}
        >
          <ClipboardList size={12} className={plan ? '' : 'text-ink/60'} />
          <span className="hidden @[420px]:inline">Plan</span>
        </button>
      )}

      {/* An ARMED goal is not a running one: the button names it as waiting,
          so "on" never claims work that has not started. Hidden entirely when
          the harness cannot express a goal — see `goalAvailable`. */}
      {goalAvailable && (
      <button
        type="button"
        onClick={onOpenGoal}
        aria-pressed={goal || Boolean(goalArm)}
        aria-label={goalArm ? 'Edit the armed goal' : goal ? 'Manage the active goal' : 'Set a goal'}
        title={goalArm ? 'Goal armed: it starts with your next message' : goalTitle(goal, goalRecord)}
        className={`tap-chip flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors cursor-pointer ${
          goal ? 'bg-ink text-canvas' : goalArm ? 'border border-dashed border-ink/30 text-muted' : 'text-muted hover:bg-ink/5'
        } ${pending ? 'opacity-60' : ''}`}
      >
        <Target size={12} className={goal ? '' : 'text-ink/60'} />
        <span className="hidden @[420px]:inline">Goal</span>
      </button>
      )}
    </div>
  );
}
