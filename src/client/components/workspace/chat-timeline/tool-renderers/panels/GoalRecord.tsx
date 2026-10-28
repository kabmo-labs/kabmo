/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `goal` TOOL's own record, rendered.
 *
 * `GoalTool` answers `{op, goal, remainingTokens, completionBudgetReport}` —
 * omp's live goal state, not the `details.items` list the sibling renderer
 * (`Goal.tsx`) draws for the older goal/`yield` card. The two share a tool name
 * and nothing else, so this module owns the omp shape and `Goal.tsx` delegates
 * to it before falling back to its own list view.
 *
 * The record is the SAME shape the composer's Goal toggle mirrors, which is why
 * the fields are read from `@/shared/lib/omp/mode/types` rather than re-declared.
 */

import { CheckCircle2, CircleDot, Pause, Target } from 'lucide-preact';
import type { GoalRecord, GoalStatus } from '@/shared/lib/omp/mode/types';
import { formatGoalDuration } from '@/shared/lib/omp/mode/format';
import type { ToolCallData } from '@/shared/types';
import { isRecord } from '@/shared/lib/util/guards';
import { MarkdownRenderer } from '@/client/components/common/MarkdownRenderer';

const STATUS_STYLE: Record<GoalStatus, { label: string; className: string }> = {
  active: { label: 'active', className: 'bg-ink/8 text-ink/70' },
  paused: { label: 'paused', className: 'bg-warning/10 text-warning' },
  'budget-limited': { label: 'budget-limited', className: 'bg-warning/10 text-warning' },
  complete: { label: 'complete', className: 'bg-success/10 text-success' },
  dropped: { label: 'dropped', className: 'bg-ink/5 text-ink/45' },
};

function statusOf(value: unknown): GoalStatus {
  return typeof value === 'string' && value in STATUS_STYLE ? (value as GoalStatus) : 'active';
}

/** Read omp's `GoalTool` details, or null for any other `goal` tool result —
 *  including the older list shape the sibling renderer handles. */
export function readGoalRecord(tool: ToolCallData): GoalRecord | null {
  const details = isRecord(tool.details) ? tool.details : undefined;
  if (!details) return null;
  const goal = details.goal;
  if (!goal || !isRecord(goal)) return null;
  if (typeof goal.objective !== 'string' || typeof goal.id !== 'string') return null;
  return goal as unknown as GoalRecord;
}

function formatTokens(record: GoalRecord): string {
  const used = record.tokensUsed.toLocaleString();
  if (record.tokenBudget === undefined) return `${used} used · no budget`;
  return `${used} / ${record.tokenBudget.toLocaleString()} (${Math.max(0, record.tokenBudget - record.tokensUsed).toLocaleString()} left)`;
}

/** The card. Returns null when the tool result is not omp's goal record, so the
 *  caller can render its own view. */
export function GoalRecordPanel({ tool }: { tool: ToolCallData }) {
  const record = readGoalRecord(tool);
  if (!record) return null;
  const status = statusOf(record.status);
  const style = STATUS_STYLE[status];
  const op = isRecord(tool.details) && typeof tool.details.op === 'string' ? tool.details.op : '';
  const completionReport =
    isRecord(tool.details) && typeof tool.details.completionBudgetReport === 'string'
      ? tool.details.completionBudgetReport
      : null;

  return (
    <div className="overflow-hidden rounded-lg border border-ink/10 bg-paper text-[12px] text-ink select-text">
      <div className="flex items-center justify-between border-b border-ink/8 bg-canvas/40 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-ink/5 text-ink/60">
            <Target size={12} />
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ink/60">Goal</span>
          {op && <span className="font-mono text-[10px] text-ink/40">{op}</span>}
        </div>
        <span className={`rounded-full px-2 py-0.5 font-mono text-[9.5px] font-medium uppercase ${style.className}`}>
          {style.label}
        </span>
      </div>

      <div className="space-y-2.5 p-3">
        <div className="rounded border border-ink/6 bg-ink/[0.03] p-2">
          <MarkdownRenderer content={record.objective} className="font-medium" />
        </div>

        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div className="rounded-md border border-ink/8 bg-canvas/30 p-2">
            <div className="text-[9.5px] font-semibold uppercase tracking-wider text-ink/40">Tokens</div>
            <div className="mt-0.5 font-mono text-[11px] text-ink/85">{formatTokens(record)}</div>
          </div>
          <div className="rounded-md border border-ink/8 bg-canvas/30 p-2">
            <div className="text-[9.5px] font-semibold uppercase tracking-wider text-ink/40">Time</div>
            <div className="mt-0.5 font-mono text-[11px] text-ink/85">{formatGoalDuration(record.timeUsedSeconds)}</div>
          </div>
        </div>

        {completionReport && (
          <div className="flex items-start gap-2 rounded-md bg-success/10 p-2.5 text-[11.5px] text-success">
            <CheckCircle2 size={13} className="mt-0.5 shrink-0" />
            <span>{completionReport}</span>
          </div>
        )}

        {!completionReport && status === 'paused' && (
          <div className="flex items-start gap-2 rounded-md bg-warning/10 p-2.5 text-[11.5px] text-warning">
            <Pause size={13} className="mt-0.5 shrink-0" />
            <span>Paused — the agent is not taking further steps until this is resumed.</span>
          </div>
        )}

        {!completionReport && status === 'active' && (
          <div className="flex items-center gap-1.5 text-[10.5px] text-ink/45">
            <CircleDot size={11} className="shrink-0" />
            <span>Automatic continuation is on — the agent keeps working after each turn.</span>
          </div>
        )}
      </div>
    </div>
  );
}
