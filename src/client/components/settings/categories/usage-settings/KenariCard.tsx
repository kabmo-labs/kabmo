import type { KenariUsageReport } from '@/shared/types';
import { StatCard } from '@/client/components/common/StatCard';
import { QuotaSection } from '@/client/components/settings/categories/usage-settings/QuotaSection';
import { UsageTable } from '@/client/components/settings/categories/usage-settings/UsageTable';
import { formatCompactTokens, formatNumber, formatRp } from '@/client/components/settings/categories/usage-settings/format';

interface KenariCardProps {
  report: KenariUsageReport;
}

/** kenari.id wallet balance, plan quota, and 30-day usage. */
export function KenariCard({ report }: KenariCardProps) {
  const { balance, usage, quota } = report;

  if (!balance && !usage && !quota) {
    return <p className="text-[11px] text-ink/50">No kenari data was returned for this account.</p>;
  }

  const balanceValue = balance
    ? balance.amountRp !== null
      ? formatRp(balance.amountRp)
      : balance.raw
    : '–';
  const balanceHint = balance
    ? balance.amountRp !== null
      ? balance.raw
      : 'Amount could not be parsed'
    : 'Balance unavailable';

  const processedTokens = usage
    ? usage.rows.reduce((sum, row) => sum + row.inputTokens + row.outputTokens, 0)
    : 0;

  return (
    <>
      <div className="@container">
        <div className="grid grid-cols-3 @[540px]:grid-cols-5 gap-2.5 items-stretch">
          <StatCard value={balanceValue} label="Wallet balance" hint={balanceHint} />
          <StatCard
            value={quota?.planName ?? '–'}
            label="Active plan"
            hint={quota ? 'kenari quota plan' : 'Quota unavailable'}
          />
          <StatCard
            value={usage ? formatNumber(usage.totalRequests) : '–'}
            label="Requests (30 days)"
            hint={usage ? 'Across all models' : 'Usage report unavailable'}
          />
          <StatCard
            value={usage ? formatRp(usage.totalCostRp) : '–'}
            label="Cost (30 days)"
            hint={usage ? 'Billed in Rupiah' : 'Usage report unavailable'}
          />
        <StatCard
          value={usage ? formatCompactTokens(processedTokens) : '–'}
          label="Tokens processed (30 days)"
          hint={usage ? 'Input + output' : 'Usage report unavailable'}
          tone="muted"
          className="col-span-2 @[540px]:col-span-1"
        />
        </div>
      </div>

      <QuotaSection quota={quota} />
      <UsageTable usage={usage} />
    </>
  );
}
