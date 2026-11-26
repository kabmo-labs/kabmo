/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The session's token totals, as the context popover prints them.
 *
 * Four rows, because they answer four different questions: how much the
 * session processed in total, how much of the prompt was fresh (a cache miss),
 * how much was served from or written to cache, and how much the model
 * generated. `total` is the provider's own processed count, so it is not
 * re-derived here — a second sum would drift from the usage panel.
 *
 * Rendered only when the telemetry carries `totals`: an ACP chat reports no
 * per-call usage, and printing zeros there would state a measurement the
 * source never made.
 */

import type { ContextTokenTotals } from '@/shared/types';
import { formatCompactTokens } from '@kabmo-labs/kabmo-format/number';

interface TokenTotalsProps {
  totals: ContextTokenTotals;
}

const ROW = 'flex justify-between gap-2';
const LABEL = 'text-ink/50 flex-shrink-0';

export function TokenTotals({ totals }: TokenTotalsProps) {
  return (
    <div className="pt-2 mt-2 border-t border-ink/10 space-y-1.5">
      <div className={ROW}>
        <span className={LABEL}>Total tokens:</span>
        <span>{formatCompactTokens(totals.total) ?? '0'}</span>
      </div>
      <div className={ROW}>
        <span className={LABEL}>Uncached:</span>
        <span>{formatCompactTokens(totals.input) ?? '0'}</span>
      </div>
      <div className={ROW}>
        <span className={LABEL}>Cache:</span>
        <span>{formatCompactTokens(totals.cacheRead + totals.cacheWrite) ?? '0'}</span>
      </div>
      <div className={ROW}>
        <span className={LABEL}>Output:</span>
        <span>{formatCompactTokens(totals.output) ?? '0'}</span>
      </div>
    </div>
  );
}
