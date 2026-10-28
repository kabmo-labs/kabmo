import type { UsageProviderSummary } from '@/shared/types';
import { ProviderCard } from '@/client/components/settings/categories/usage-settings/ProviderCard';
import { KenariCard } from '@/client/components/settings/categories/usage-settings/KenariCard';
import { DeepSeekCard } from '@/client/components/settings/categories/usage-settings/DeepSeekCard';
import { LimitsSection } from '@/client/components/settings/categories/usage-settings/LimitsSection';

const DEEPSEEK_NOTE =
  'DeepSeek exposes no usage or quota API — only the prepaid balance (and the web console at platform.deepseek.com) is available.';

interface ProviderDetailProps {
  summary: UsageProviderSummary;
}

/**
 * Renders one provider's card. kenari and DeepSeek carry richer reports (wallet
 * and Rupiah quota / prepaid balance); every other provider renders the generic
 * quota windows, which for a pay-as-you-go vendor is its credit balance.
 */
export function ProviderDetail({ summary }: ProviderDetailProps) {
  const hasRichReport = Boolean(summary.kenari || summary.deepseek);

  return (
    <ProviderCard
      providerName={summary.name}
      providerSlug={summary.id}
      iconUrl={summary.iconUrl}
      credentialSources={summary.credentialSources}
      error={summary.error}
      note={summary.deepseek ? DEEPSEEK_NOTE : undefined}
    >
      {summary.kenari && <KenariCard report={summary.kenari} />}
      {summary.deepseek && <DeepSeekCard report={summary.deepseek} />}

      {/* The rich reports already render their own quota and usage tables, so
          the generic windows would only duplicate them. When the provider
          failed outright and reported no windows, the error line above already
          says so — a second "no quota source" note would contradict it. */}
      {!hasRichReport && (summary.limits.length > 0 || !summary.error) && (
        <LimitsSection
          limits={summary.limits}
          tracked={summary.tracked}
          unavailable={summary.limitsUnavailable}
          notes={summary.notes}
        />
      )}
    </ProviderCard>
  );
}
