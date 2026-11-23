import type { TokenPortalUsageReport } from '@/shared/types';
import { StatCard } from '@/client/components/common/StatCard';
import { formatCurrency } from '@/client/components/settings/categories/usage-settings/format';

interface TokenPortalCardProps {
  report: TokenPortalUsageReport;
}

/**
 * TokenPortal's wallet, as `GET /v1/key` reports it.
 *
 * The numbers are the vendor's own money, so they are rendered with the
 * currency it names (Rupiah on the live endpoint) and never as tokens. A key
 * without a cap says "No cap" instead of drawing a 0%-used bar: a cap that was
 * never set is not a quota window.
 */
export function TokenPortalCard({ report }: TokenPortalCardProps) {
  const wallet = report.balance;

  if (!wallet) {
    return (
      <p className="text-[11px] text-ink/60">
        TokenPortal returned no balance for this key. Refresh to try again.
      </p>
    );
  }

  const spent = wallet.limit !== null && wallet.limitRemaining !== null
    ? Math.max(0, wallet.limit - wallet.limitRemaining)
    : null;
  const percent = wallet.limit !== null && spent !== null && wallet.limit > 0
    ? Math.min(100, (spent / wallet.limit) * 100)
    : null;

  return (
    <>
      <div className="@container">
        <div className="grid grid-cols-2 @[540px]:grid-cols-4 gap-2.5 items-stretch">
          <StatCard
            value={formatCurrency(wallet.balance, wallet.currency)}
            label="Credit balance"
            hint={wallet.label ? `Key ${wallet.label}` : `Left on this key, in ${wallet.currency}`}
          />
          <StatCard
            value={wallet.limit === null ? 'No cap' : formatCurrency(wallet.limit, wallet.currency)}
            label="Key limit"
            hint={wallet.limit === null
              ? 'Spending is not capped on this key'
              : spent !== null
                ? `${formatCurrency(spent, wallet.currency)} spent`
                : 'Cap set by the operator'}
            tone={wallet.limit === null ? 'muted' : 'default'}
          />
          <StatCard
            value={wallet.sessionBudget === null ? 'Not set' : formatCurrency(wallet.sessionBudget, wallet.currency)}
            label="Session budget"
            hint={wallet.sessionBudget === null ? 'No per-session cap' : 'Applies to one gateway session'}
            tone="muted"
          />
          <StatCard
            value={wallet.isFreeTier ? 'Free' : 'Paid'}
            label="Tier"
            hint={wallet.isFreeTier ? 'Free-tier limits apply' : 'No free-tier limit on this key'}
            tone="muted"
          />
        </div>
      </div>

      {percent !== null && spent !== null && (
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] font-semibold text-ink">Key limit used</span>
            <span className="text-[10px] text-ink/60">
              {formatCurrency(spent, wallet.currency)} of {formatCurrency(wallet.limit ?? 0, wallet.currency)}
            </span>
          </div>
          <div
            className="h-1.5 w-full bg-ink/10 rounded-full overflow-hidden"
            role="progressbar"
            aria-label="Key limit used"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(percent)}
          >
            <div
              className={`h-full rounded-full ${wallet.limitRemaining !== null && wallet.limitRemaining <= 0 ? 'bg-error/70' : 'bg-ink/80'}`}
              style={{ width: `${percent}%` }}
            />
          </div>
          {wallet.limitRemaining !== null && (
            <p className="text-[10px] text-ink/50">
              {formatCurrency(wallet.limitRemaining, wallet.currency)} left under the cap
            </p>
          )}
        </div>
      )}

      <p className="text-[10px] text-ink/50 leading-relaxed">
        Balance and caps come from TokenPortal&rsquo;s <span className="font-mono">/v1/key</span> endpoint in
        {' '}{wallet.currency}; top-ups and transaction history live in its console.
      </p>
    </>
  );
}
