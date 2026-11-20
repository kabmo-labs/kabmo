import { AlertCircle } from 'lucide-preact';
import { PanelHeader } from '@/client/components/workspace/panel-header';
import { PanelHeading } from '@/client/components/workspace/panel-header/title-policy';
import { RefreshButton } from '@/client/components/common/header-button';
import { ProviderDetail } from '@/client/components/settings/categories/usage-settings/ProviderDetail';
import { buildProviders } from '@/client/components/settings/categories/usage-settings/providers';
import { formatDateTime } from '@/client/components/settings/categories/usage-settings/format';
import { SavedResetsSection } from '@/client/components/settings/categories/usage-settings/SavedResetsSection';
import { newestUsageReport } from '@/client/components/workspace/usage-panel/report';
import { useUsageReport } from '@/client/hooks/settings/useUsageReport';
import { useRealtimeTopic } from '@/client/hooks/ui/realtime';
import { TOPIC_USAGE } from '@/shared/lib/realtime/protocol';
import type { UsageReport } from '@/shared/types';

interface UsagePanelProps {
  className?: string;
  /** False while the panel is hidden (desktop right panel / mobile tab):
   *  releases the usage topic. */
  active?: boolean;
  /** The column's chip already names this view; see `title-policy.tsx`. */
  tabsMode?: boolean;
}

/** Right-panel Usage: every provider's quota and balance, one card each. */
export function UsagePanel({ className = '', active = true, tabsMode = false }: UsagePanelProps) {
  const { report: fetched, isLoading, error, reload } = useUsageReport();

  // The topic is the read path: it re-resolves on subscribe, so switching to
  // this panel reads fresh state, and no poll is needed while it is open. The
  // HTTP read is the first paint and the user's own Refresh — which must force
  // past the server's one-minute quota cache, something a topic refresh cannot
  // express, so its answer is the fresher of the two (see `newestUsageReport`).
  const usage = useRealtimeTopic<UsageReport>(TOPIC_USAGE, { enabled: active });
  const report = newestUsageReport(usage.data, fetched);

  const providers = report ? buildProviders(report) : [];

  if (error && !report) {
    return (
      <div className={`flex h-full w-full flex-col items-center justify-center gap-2 p-8 text-center text-xs ${className}`}>
        <AlertCircle size={16} className="text-error" />
        <p className="text-error text-xs">{error}</p>
        <button
          type="button"
          onClick={() => reload()}
          className="text-[11px] font-semibold text-ink/70 hover:text-ink underline underline-offset-2"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!report) {
    return (
      <div className={`flex h-full w-full items-center justify-center text-ink/40 text-xs ${className}`}>
        Loading provider usage...
      </div>
    );
  }

  return (
    <div className={`flex h-full w-full min-w-0 min-h-0 flex-col overflow-hidden bg-paper text-xs text-ink ${className}`}>
      <PanelHeader
        left={
          <>
            <PanelHeading id="usage" tabsMode={tabsMode}>
              <h2 className="text-xs font-semibold text-ink uppercase tracking-wider">Usage</h2>
            </PanelHeading>
            <span className="text-[11px] text-ink/50 truncate">
              Updated {formatDateTime(report.generatedAt)}
            </span>
            {report.isMock && (
              <span className="text-[10px] font-mono uppercase tracking-wider bg-ink/5 border border-ink/15 rounded px-1.5 py-0.5 text-ink/60">
                Mock
              </span>
            )}
          </>
        }
        right={
          <RefreshButton
            label="Refresh usage"
            onClick={() => reload({ force: true })}
            busy={isLoading || usage.refreshing}
            disabled={isLoading}
          />
        }
      />

      <div className="flex-1 min-w-0 min-h-0 w-full overflow-y-auto scrollbar-overlay-container p-3.5 space-y-4">
        {error && <p className="text-error text-xs">{error}</p>}
        {providers.length > 0 ? (
          providers.map((provider) => (
            <ProviderDetail key={provider.id} summary={provider.summary} />
          ))
        ) : (
          <p className="text-[11px] text-ink/50 leading-relaxed">
            No provider credentials detected. Add an API key in Settings → Providers and it will appear here.
          </p>
        )}
        <SavedResetsSection />
      </div>
    </div>
  );
}
