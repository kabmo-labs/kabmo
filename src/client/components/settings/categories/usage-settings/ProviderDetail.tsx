import type { UsageProviderSummary } from '@/shared/types';
import { ProviderCard } from '@/client/components/settings/categories/usage-settings/ProviderCard';
import { KenariCard } from '@/client/components/settings/categories/usage-settings/KenariCard';
import { DeepSeekCard } from '@/client/components/settings/categories/usage-settings/DeepSeekCard';
import { TokenHarborCard } from '@/client/components/settings/categories/usage-settings/TokenHarborCard';
import { LimitsSection } from '@/client/components/settings/categories/usage-settings/LimitsSection';

const DEEPSEEK_NOTE =
  'DeepSeek exposes no usage or quota API — only the prepaid balance (and the web console at platform.deepseek.com) is available.';

const TOKEN_HARBOR_NOTE =
  'Token Harbor reports percentages, never a dollar remainder. Request history and per-request cost are on its usage dashboard.';

interface ProviderDetailProps {
  summary: UsageProviderSummary;
}

/**
 * Renders one provider's card. kenari and DeepSeek carry richer reports (wallet
 * and Rupiah quota / prepaid balance), Token Harbor its Pass and free allowance;
 * every other provider renders the generic quota windows, which for a
 * pay-as-you-go vendor is its credit balance.
 */
export function ProviderDetail({ summary }: ProviderDetailProps) {
  const hasRichReport = Boolean(summary.kenari || summary.deepseek || summary.tokenHarbor);
  const note = summary.tokenHarbor ? TOKEN_HARBOR_NOTE : summary.deepseek ? DEEPSEEK_NOTE : undefined;

  return (
    <ProviderCard
      providerName={summary.name}
      providerSlug={summary.id}
      iconUrl={summary.iconUrl}
      credentialSources={summary.credentialSources}
      error={summary.error}
      note={note}
    >
      {summary.kenari && <KenariCard report={summary.kenari} />}
      {summary.deepseek && <DeepSeekCard report={summary.deepseek} />}
      {summary.tokenHarbor && <TokenHarborCard report={summary.tokenHarbor} />}

      {/* The rich reports already render their own quota and usage tables, so
          the generic windows would only duplicate them. When the provider
          failed outright and reported no windows, the error line above already
          says so — a second "no quota source" note would contradict it. */}
      {!hasRichReport && (summary.limits.length > 0 || !summary.error) && (
        <LimitsSection
          providerId={summary.id}
          limits={summary.limits}
          tracked={summary.tracked}
          unavailable={summary.limitsUnavailable}
          notes={summary.notes}
        />
      )}
    </ProviderCard>
  );
}
