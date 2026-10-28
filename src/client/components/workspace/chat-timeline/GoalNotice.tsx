/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The body of a goal notice: the objective, the budget it was injected with,
 * and the instructions omp attached.
 *
 * Why a card of its own: a goal turn is `display: false` — omp does not put it
 * in the conversation — but the transcript has no other slot for a
 * `custom_message`, so each one lands as a generic notice whose subtitle is its
 * first line. For a continuation that line is a raw HTML comment and the body
 * is the whole internal prompt, objective buried in the middle. Here the
 * objective leads, the numbers read as numbers, and the prompt is demoted to
 * reference text.
 *
 * This is the card the `SystemNotice` header sits on top of; it is rendered
 * OPEN, so it carries no "which injection is this" hint of its own — the
 * header's badge says it.
 *
 * `Goal` in the timeline is two other cards already (`tool-renderers/panels/
 * GoalRecord.tsx` draws the `goal` tool's result, `Goal.tsx` the older
 * goal/`yield` list); this is the injected-message side of the same feature.
 */

import { MarkdownRenderer } from '@/client/components/common/MarkdownRenderer';
import { formatGoalDuration, formatGoalTokens } from '@/shared/lib/omp/mode/format';
import type { GoalNoticeData } from '@/shared/lib/omp/mode/notice';

export function GoalNotice({ data }: { data: GoalNoticeData }) {
  const figures: string[] = [];
  if (data.tokensUsed !== undefined) figures.push(`tokens ${formatGoalTokens(data.tokensUsed)}`);
  figures.push(`budget ${data.tokenBudget === undefined ? 'none' : formatGoalTokens(data.tokenBudget)}`);
  if (data.remaining) figures.push(`left ${data.remaining}`);
  if (data.timeUsedSeconds !== undefined) figures.push(formatGoalDuration(data.timeUsedSeconds));

  return (
    <div className="space-y-2.5">
      <div className="rounded-lg border border-ink/8 bg-paper p-3">
        <div className="mb-1 text-[9.5px] font-semibold uppercase tracking-wider text-ink/40">Objective</div>
        <MarkdownRenderer content={data.objective || '_No objective recorded._'} className="text-[12px] leading-relaxed" />
      </div>

      {/* The figures omp injected this turn with — the strip above the composer
          shows the live ones, so this is the historical reading at that turn. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10.5px] text-ink/45">
        {figures.map((figure) => (
          <span key={figure}>{figure}</span>
        ))}
      </div>

      {data.instructions && (
        <div className="rounded-lg border border-ink/8 bg-canvas/40 p-3">
          <div className="mb-1.5 text-[9.5px] font-semibold uppercase tracking-wider text-ink/40">
            Instructions sent with it
          </div>
          <MarkdownRenderer content={data.instructions} className="text-[11.5px] leading-relaxed text-ink/75" />
        </div>
      )}
    </div>
  );
}
