import type { ComponentChildren } from 'preact';
import type { TokenHarborUsageReport } from '@/shared/types';
import { StatCard } from '@/client/components/common/StatCard';
import {
  formatDate,
  formatUsageAmount,
} from '@/client/components/settings/categories/usage-settings/format';

interface AllowanceBarProps {
  label: string;
  /** Integer percent, or null when the endpoint reported no usable number. */
  percent: number | null;
  /** The provider's own "spent" flag; it outranks the rounded percentage. */
  spent: boolean;
  /** False when this allowance is switched off rather than merely unused. */
  enabled?: boolean;
  /** The one sentence that explains this bar's state, when it needs one. */
  children?: ComponentChildren;
}

/**
 * One allowance bar. Same bar and "Used X%" reading as the generic quota rows,
 * so a percentage reads identically wherever it appears in the panel.
 *
 * Focal point is the Pass bar: it decides whether covered models keep working.
 * The only colour outside the palette is the error tint on a spent window, and
 * the bar also states the fact as text (a colour alone would not).
 */
function AllowanceBar({ label, percent, spent, enabled = true, children }: AllowanceBarProps) {
  const width = enabled && percent !== null ? Math.min(100, Math.max(0, percent)) : 0;
  const state = !enabled ? 'Off' : spent ? 'Spent' : percent !== null ? `${percent}% used` : 'Not reported';

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold text-ink">{label}</span>
        <span className={`text-[10px] ${spent ? 'text-error' : 'text-ink/60'}`}>{state}</span>
      </div>
      <div
        className="h-1.5 w-full bg-ink/10 rounded-full overflow-hidden"
        {...(enabled
          ? {
              role: 'progressbar',
              'aria-label': label,
              'aria-valuemin': 0,
              'aria-valuemax': 100,
              ...(percent !== null ? { 'aria-valuenow': width } : {}),
            }
          : {})}
      >
        <div
          className={`h-full rounded-full ${spent ? 'bg-error/70' : enabled ? 'bg-ink/80' : 'bg-ink/20'}`}
          style={{ width: `${width}%` }}
        />
      </div>
      {children}
    </div>
  );
}

interface TokenHarborCardProps {
  report: TokenHarborUsageReport;
}

/** Token Harbor Pass and free-model allowance, as the percentages it reports. */
export function TokenHarborCard({ report }: TokenHarborCardProps) {
  const allowance = report.allowance;

  if (!allowance) {
    return (
      <p className="text-[11px] text-ink/60">
        Token Harbor returned no allowance for this key. Refresh to try again.
      </p>
    );
  }

  const { onPlan, activated, resetAt } = allowance;
  const percent = (value: number | null): string => (value === null ? 'n/a' : formatUsageAmount(value, 'percent'));

  return (
    <>
      <div className="@container">
        <div className="grid grid-cols-2 @[540px]:grid-cols-4 gap-2.5 items-stretch">
          <StatCard
            value={allowance.planName ?? 'No Pass'}
            label="Plan"
            hint={onPlan ? 'Pass allowance applies' : 'Covered models bill your wallet'}
          />
          <StatCard
            value={onPlan ? percent(allowance.planUsedPct) : 'n/a'}
            label="Pass week used"
            hint={onPlan ? (allowance.planExhausted ? 'Spent for this window' : 'Of this 7-day window') : 'No Pass to draw on'}
            tone={onPlan ? 'default' : 'muted'}
          />
          <StatCard
            value={percent(allowance.usedPct)}
            label="Free week used"
            hint={allowance.modelsEnabled ? 'Of this 7-day window' : 'Free models are off'}
            tone="muted"
          />
          <StatCard
            value={activated && resetAt ? formatDate(resetAt) : 'Not started'}
            label="Resets"
            hint={activated ? 'Pass and free share one window' : 'The window begins with your first request'}
            tone="muted"
          />
        </div>
      </div>

      <div className="space-y-3">
        <h4 className="text-[10px] font-mono font-semibold uppercase tracking-wider text-muted">Allowance</h4>

        {onPlan ? (
          <AllowanceBar
            label={allowance.planName ?? 'Pass allowance'}
            percent={allowance.planUsedPct}
            spent={allowance.planExhausted}
          >
            {allowance.planExhausted && (
              <p className="text-[10px] text-ink/70 leading-relaxed">
                Covered calls resume when the window resets. Until then they run only if Keep working after my Pass
                allowance runs out is on in Dashboard, Billing, which bills your wallet at the Pass discount.
              </p>
            )}
          </AllowanceBar>
        ) : (
          <p className="text-[10px] text-ink/70 leading-relaxed">
            This account holds no Pass, so there is no Pass allowance to draw. Covered models bill your wallet.
          </p>
        )}

        <AllowanceBar
          label="Free allowance"
          percent={allowance.usedPct}
          spent={allowance.exhausted}
          enabled={allowance.modelsEnabled}
        >
          {allowance.modelsEnabled ? (
            allowance.freeModels.length > 0 && (
              <p className="text-[10px] text-ink/60 leading-relaxed break-words">
                Free models now: {allowance.freeModels.join(', ')}
              </p>
            )
          ) : (
            <p className="text-[10px] text-ink/70 leading-relaxed">
              Free models are switched off for this account, so calls to them are refused whatever the percentage says.
              Turn them back on in the Token Harbor dashboard, under Data and privacy.
            </p>
          )}
        </AllowanceBar>

        {!activated && (
          <p className="text-[10px] text-ink/60 leading-relaxed">
            The 7-day window starts with this account's first request. Both allowances reset together.
          </p>
        )}
      </div>
    </>
  );
}
