import type { UsageProviderSummary } from '@/shared/types';
import { ProviderCard } from '@/client/components/settings/categories/usage-settings/ProviderCard';
import { KenariCard } from '@/client/components/settings/categories/usage-settings/KenariCard';
import { DeepSeekCard } from '@/client/components/settings/categories/usage-settings/DeepSeekCard';
import { TokenHarborCard } from '@/client/components/settings/categories/usage-settings/TokenHarborCard';
import { TokenPortalCard } from '@/client/components/settings/categories/usage-settings/TokenPortalCard';
import { LimitsSection } from '@/client/components/settings/categories/usage-settings/LimitsSection';

const DEEPSEEK_NOTE =
  'DeepSeek exposes no usage or quota API — only the prepaid balance (and the web console at platform.deepseek.com) is available.';

const TOKEN_HARBOR_NOTE =
  'Token Harbor reports percentages, never a dollar remainder. Request history and per-request cost are on its usage dashboard.';

/**
 * omp's Command Code usage adapter reads `/alpha/billing/credits` with an
 * `api_key` credential and skips an OAuth login (measured on omp 19.1.1: a
 * stored `oauth` credential puts the provider in `accountsWithoutUsage`, and
 * both `/alpha/*` and `/internal/usage` answer 401 to that token). So the empty
 * card is a credential-type fact, not a plan with no quota — and it needs the
 * fix, which the generic "invalid or expired credential" copy does not name.
 */
const COMMAND_CODE_EMPTY =
  'omp tracks Command Code, but its usage read needs an API key created in Studio — the signed-in OAuth credential cannot read its billing endpoint. Add an API key in Settings → Providers to see the 5-hour, weekly and credit windows.';

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
  const hasRichReport = Boolean(summary.kenari || summary.deepseek || summary.tokenHarbor || summary.tokenPortal);
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
      {summary.tokenPortal && <TokenPortalCard report={summary.tokenPortal} />}

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
          {...(summary.id === 'commandcode' && summary.limitsUnavailable
            ? { emptyReason: COMMAND_CODE_EMPTY }
            : {})}
          notes={summary.notes}
        />
      )}
    </ProviderCard>
  );
}
