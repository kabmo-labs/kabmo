/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The timing half of the context popover: turns/steps, how long the model and
 * the tools spent, and the rates behind them.
 *
 * EVERY row is conditional on its measurement existing. An ACP chat reports no
 * per-call timing and an older transcript has no `ttft`; printing `0s` there
 * would state a measurement the source never made — the same defect
 * `cacheHitAverage` already avoids by hiding its row.
 *
 * `turns` is the count of user prompts and `steps` the count of assistant
 * calls (one LLM request each). They are read straight off the telemetry the
 * popover already receives, so a second counter cannot drift from them.
 */

import type { SessionTimingStats } from '@/shared/types';
import { formatSpan } from '@kabmo-labs/kabmo-format/duration';

interface SessionStatsProps {
  /** User prompts; a run may contain several LLM/tool turns. */
  turns: number;
  /** Assistant messages, i.e. one LLM request each. */
  steps: number;
  timing?: SessionTimingStats;
}

const ROW = 'flex justify-between gap-2';
const LABEL = 'text-ink/50 flex-shrink-0';

export function SessionStats({ turns, steps, timing }: SessionStatsProps) {
  const llm = formatSpan(timing?.llmMs);
  const tool = formatSpan(timing?.toolMs);
  const ttft = formatSpan(timing?.ttftAvgMs);
  const lastRate = timing?.lastTps === undefined ? undefined : timing.lastTps.toFixed(1);
  const avgRate = timing?.avgTps === undefined ? undefined : timing.avgTps.toFixed(1);
  // The row is drawn only when at least one rate was measured; the missing
  // side prints `—` rather than a zero, which would claim a measurement.
  const rateLabel = lastRate || avgRate ? `${avgRate ?? '—'}t/s / ${lastRate ?? '—'}t/s` : undefined;

  return (
    <div className="pt-2 mt-2 border-t border-ink/10 space-y-1.5">
      <div className={ROW}>
        <span className={LABEL}>Turns / steps:</span>
        <span>{turns} / {steps}</span>
      </div>
      {llm && (
        <div className={ROW}>
          <span className={LABEL}>LLM time:</span>
          <span>{llm}</span>
        </div>
      )}
      {tool && (
        <div className={ROW}>
          <span className={LABEL}>Tool time:</span>
          <span>{tool}</span>
        </div>
      )}
      {ttft && (
        <div className={ROW}>
          <span className={LABEL}>TTFT avg:</span>
          <span>{ttft}</span>
        </div>
      )}
      {rateLabel && (
        <div className={ROW}>
          <span className={LABEL}>Avg / Last:</span>
          <span>{rateLabel}</span>
        </div>
      )}
    </div>
  );
}
