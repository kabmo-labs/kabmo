import { useEffect, useState } from 'preact/hooks';
import { AlertCircle, RefreshCw } from 'lucide-preact';
import { UsageSidebarList } from '@/client/components/settings/categories/usage-settings/SidebarList';
import { buildProviders, type UsageProviderId } from '@/client/components/settings/categories/usage-settings/providers';
import { ProviderDetail } from '@/client/components/settings/categories/usage-settings/ProviderDetail';
import { SavedResetsSection } from '@/client/components/settings/categories/usage-settings/SavedResetsSection';
import { formatDateTime } from '@/client/components/settings/categories/usage-settings/format';
import { useUsageReport } from '@/client/hooks/settings/useUsageReport';
import { useSettingsMasterDetail } from '@/client/hooks/settings/master-detail';
import { SettingsMasterDetail } from '@/client/components/settings/master-detail';

/** Settings → Usage: provider quota, balances, and locally recorded burn. */
export function UsageSettings() {
  const masterDetail = useSettingsMasterDetail();
  const { report, isLoading, error, reload } = useUsageReport();
  const [selectedProviderId, setSelectedProviderId] = useState<UsageProviderId>('');

  const providers = report ? buildProviders(report) : [];
  const selected = providers.find((provider) => provider.id === selectedProviderId) ?? providers[0];

  // The report can arrive with a different provider set (a key was added or
  // removed); keep the selection pointing at something that exists.
  useEffect(() => {
    if (selected && selected.id !== selectedProviderId) setSelectedProviderId(selected.id);
  }, [selected, selectedProviderId]);

  if (error && !report) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-8 text-center text-xs">
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
      <div className="flex h-full w-full items-center justify-center text-ink/40 text-xs">
        Loading provider usage...
      </div>
    );
  }

  return (
    <div className="flex h-full w-full overflow-hidden bg-paper text-xs text-ink">
      <SettingsMasterDetail
        pane={masterDetail.pane}
        onBack={masterDetail.back}
        listLabel="Usage"
        list={
          <UsageSidebarList
            report={report}
            selectedProviderId={selected?.id ?? ''}
            onSelectProvider={(id) => {
              setSelectedProviderId(id);
              masterDetail.openDetail();
            }}
          />
        }
        detail={
          <div className="flex-1 h-full overflow-hidden flex flex-col">
            <div className="px-3.5 py-2.5 border-b border-ink/10 flex items-center justify-between gap-3 flex-shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs font-semibold text-ink/75 truncate">
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
                <RefreshCw size={12} className={isLoading ? 'animate-spin text-ink' : ''} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-overlay-container p-3.5 space-y-4">
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
        }
      />
    </div>
  );
}
