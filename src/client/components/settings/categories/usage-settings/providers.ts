import type { UsageLimitWindow, UsageProviderSummary, UsageReport } from '@/shared/types';
import { formatAmount, formatUsd } from '@/client/components/settings/categories/usage-settings/format';

/**
 * Providers surfaced in the Settings → Usage sidebar and the Usage right panel.
 * The id is the provider slug, so the set is open-ended: any provider omp can
 * authenticate shows up here without a code change.
 */
export type UsageProviderId = string;

export interface ProviderEntry {
  id: UsageProviderId;
  name: string;
  /** The provider's fetched web icon, when the server has one. */
  iconUrl?: string;
  /** Provider-side failure, already human-readable. */
  error?: string;
  /** Short status line under the name. */
  hint: string;
  /** Provider-reported quota windows; empty when it exposes no usage endpoint. */
  limits: UsageLimitWindow[];
  /** Whether omp ships a usage adapter for this provider. */
  tracked: boolean;
  /** omp tracks this provider but its endpoint produced nothing. */
  limitsUnavailable?: boolean;
  summary: UsageProviderSummary;
}

/** Compact one-line summary of the most-used quota window. */
function limitHint(limits: UsageLimitWindow[]): string | undefined {
  const used = limits.filter((limit) => limit.usedFraction !== undefined);
  if (used.length === 0) {
    // A credit balance has no limit to take a fraction of; the remaining
    // amount IS the whole story.
    const credit = limits.find((limit) => limit.unit === 'usd' && limit.remaining !== undefined);
    if (credit) return `${formatUsd(credit.remaining ?? 0)} left`;
    return limits[0]?.label;
  }
  const binding = used.reduce((worst, limit) =>
    (limit.usedFraction ?? 0) > (worst.usedFraction ?? 0) ? limit : worst,
  );
  const percent = Math.round((binding.usedFraction ?? 0) * 100);
  return binding.windowLabel ? `${percent}% · ${binding.windowLabel}` : `${percent}% used`;
}

/** Derives the provider list (status + hint) from a usage report. */
export function buildProviders(report: UsageReport): ProviderEntry[] {
  return report.providers.map((summary) => ({
    id: summary.id,
    name: summary.name,
    ...(summary.iconUrl ? { iconUrl: summary.iconUrl } : {}),
    error: summary.error,
    hint: providerHint(summary),
    limits: summary.limits,
    tracked: summary.tracked,
    limitsUnavailable: summary.limitsUnavailable,
    summary,
  }));
}

function providerHint(summary: UsageProviderSummary): string {
  const plan = summary.kenari?.quota?.planName;
  if (plan) return plan;
  const balance = summary.deepseek?.balance?.entries[0];
  if (balance) return `${balance.currency} ${formatAmount(balance.totalBalance)}`;
  return limitHint(summary.limits) ?? 'No quota reported';
}

/** Human-readable connection state for a provider entry. */
export function statusLabel(provider: ProviderEntry): string {
  return provider.error ? 'Error' : 'Connected';
}
