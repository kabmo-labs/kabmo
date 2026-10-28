import type { UsageReport } from '@/shared/types';
import { buildProviders, statusLabel, type ProviderEntry, type UsageProviderId } from '@/client/components/settings/categories/usage-settings/providers';
import { ProviderIconPlate } from '@/client/components/common/provider-icon/Plate';

interface UsageSidebarListProps {
  report: UsageReport;
  selectedProviderId: UsageProviderId;
  onSelectProvider: (providerId: UsageProviderId) => void;
}

/**
 * The provider's mark, on the same plate the provider settings list uses — so a
 * gateway whose site logo was fetched shows that logo here too, instead of the
 * initials its unknown slug would produce.
 */
function ProviderBadge({ provider }: { provider: ProviderEntry }) {
  return (
    <ProviderIconPlate
      provider={{
        slug: provider.id,
        name: provider.name,
        ...(provider.iconUrl ? { iconUrl: provider.iconUrl } : {}),
      }}
      size={20}
    />
  );
}

export function UsageSidebarList({
  report,
  selectedProviderId,
  onSelectProvider,
}: UsageSidebarListProps) {
  const providers = buildProviders(report);

  return (
    <div className="w-full md:w-64 md:border-r border-ink/10 h-full flex flex-col bg-paper/50 flex-shrink-0 select-none">
      <div className="px-3.5 py-2.5 border-b border-ink/10 flex items-center justify-between">
        <span className="text-xs font-semibold text-ink">
          {providers.length} provider{providers.length === 1 ? '' : 's'} with keys
        </span>
      </div>

      <div className="flex-1 scrollbar-overlay-container p-1.5 space-y-3 text-xs">
        {providers.length === 0 ? (
          <p className="px-2.5 py-3 text-[11px] text-ink/50 leading-relaxed">
            No provider credentials detected. Add an API key in Settings → Providers.
          </p>
        ) : (
          <div>
            <div className="px-2.5 pt-1.5 pb-1 text-[10px] font-bold text-ink/50 uppercase tracking-wider">
              Providers
            </div>
            <div className="space-y-0.5">
              {providers.map((provider) => {
                const isSelected = provider.id === selectedProviderId;

                return (
                  <button
                    key={provider.id}
                    type="button"
                    onClick={() => onSelectProvider(provider.id)}
                    className={`w-full text-left px-2.5 py-2 rounded-lg transition-colors cursor-pointer flex flex-col gap-0.5 group ${
                      isSelected
                        ? 'bg-ink/10 text-ink font-medium shadow-2xs'
                        : 'text-ink/80 hover:bg-ink/5 hover:text-ink'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <div className="relative">
                          <ProviderBadge provider={provider} />
                          <span
                            className={`absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full ${
                              provider.error ? 'bg-error/60' : 'bg-ink'
                            }`}
                          />
                        </div>
                        <span className="font-semibold text-xs text-ink truncate">{provider.name}</span>
                      </div>
                      <span
                        className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-ink/10 font-medium ${
                          provider.error ? 'text-error' : 'text-ink/70'
                        }`}
                      >
                        {statusLabel(provider)}
                      </span>
                    </div>
                    <p className="text-[11px] text-ink/60 line-clamp-1 leading-snug pl-5">{provider.hint}</p>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
