import { useEffect } from 'preact/hooks';
import { AlertCircle, RefreshCw } from 'lucide-preact';
import { ProviderDetail } from '@/client/components/settings/categories/usage-settings/ProviderDetail';
import { buildProviders, type UsageProviderId } from '@/client/components/settings/categories/usage-settings/providers';
import { formatDateTime } from '@/client/components/settings/categories/usage-settings/format';
import { ProviderSelect } from '@/client/components/workspace/usage-panel/ProviderSelect';
import { SavedResetsSection } from '@/client/components/settings/categories/usage-settings/SavedResetsSection';
import { newestUsageReport } from '@/client/components/workspace/usage-panel/report';
import { useUsageReport } from '@/client/hooks/settings/useUsageReport';
import { useSessionState } from '@/client/hooks/workspace/session-state';
import { useRealtimeTopic } from '@/client/hooks/ui/realtime';
import { TOPIC_USAGE } from '@/shared/lib/realtime/protocol';
import type { UsageReport } from '@/shared/types';

interface UsagePanelProps {
  className?: string;
  /** False while the panel is hidden (desktop right panel / mobile tab):
   *  releases the usage topic. */
  active?: boolean;
}

/** Right-panel Usage: the selected provider's quota and balance via a dropdown. */
export function UsagePanel({ className = '', active = true }: UsagePanelProps) {
  const { report: fetched, isLoading, error, reload } = useUsageReport();
  const [selectedProviderId, setSelectedProviderId] = useSessionState<UsageProviderId>(
    'usage.selectedProviderId',
    '',
  );

  // The topic is the read path: it re-resolves on subscribe, so switching to
  // this panel reads fresh state, and no poll is needed while it is open. The
  // HTTP read is the first paint and the user's own Refresh — which must force
  // past the server's one-minute quota cache, something a topic refresh cannot
  // express, so its answer is the fresher of the two (see `newestUsageReport`).
  const usage = useRealtimeTopic<UsageReport>(TOPIC_USAGE, { enabled: active });
  const report = newestUsageReport(usage.data, fetched);

  // Derived before every early return: a hook must not sit behind a conditional
  // return, or the hook count changes between the loading and loaded renders.
  const providers = report ? buildProviders(report) : [];
  const selected = providers.find((provider) => provider.id === selectedProviderId) ?? providers[0];

  // A provider can disappear from the report (its key was removed) or a new one
  // can take the first slot; keep the persisted selection valid.
  useEffect(() => {
    if (selected && selected.id !== selectedProviderId) setSelectedProviderId(selected.id);
  }, [selected, selectedProviderId, setSelectedProviderId]);

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
      <div className="px-3.5 py-2.5 border-b border-ink/10 flex items-center justify-between gap-3 flex-shrink-0 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-xs font-semibold text-ink uppercase tracking-wider">Usage</h2>
          <span className="text-[11px] text-ink/50 truncate">
            Updated {formatDateTime(report.generatedAt)}
          </span>
          {report.isMock && (
            <span className="text-[10px] font-mono uppercase tracking-wider bg-ink/5 border border-ink/15 rounded px-1.5 py-0.5 text-ink/60">
              Mock
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => reload({ force: true })}
          disabled={isLoading}
          className="p-1.5 bg-paper border border-ink/15 rounded-md hover:bg-ink/5 text-ink/80 transition-colors disabled:opacity-50 flex-shrink-0"
          title="Refresh usage"
        >
          <RefreshCw size={12} className={isLoading || usage.refreshing ? 'animate-spin text-ink' : ''} />
        </button>
      </div>

      {providers.length > 0 && (
        <div className="px-3.5 py-2.5 border-b border-ink/10 flex-shrink-0 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[11px] font-semibold text-ink/60 flex-shrink-0">Provider</span>
            <ProviderSelect
              providers={providers}
              value={selected?.id ?? ''}
              onChange={setSelectedProviderId}
            />
          </div>
        </div>
      )}

      <div className="flex-1 min-w-0 min-h-0 w-full overflow-y-auto scrollbar-overlay-container p-3.5 space-y-4">
        {error && <p className="text-error text-xs">{error}</p>}
        {selected ? (
          <ProviderDetail summary={selected.summary} />
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
