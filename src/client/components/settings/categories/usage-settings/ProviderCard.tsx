import type { ReactNode } from 'preact/compat';
import { AlertCircle } from 'lucide-preact';
import { ProviderIconPlate } from '@/client/components/common/provider-icon/Plate';

interface ProviderCardProps {
  providerName: string;
  /** Slug + fetched web icon, so the card header carries the provider's own mark. */
  providerSlug?: string;
  iconUrl?: string;
  /** Where the credential was found, e.g. "models.yml · agent.db". */
  credentialSources: string[];
  /** Provider-side failure, already human-readable. */
  error?: string;
  note?: string;
  children: ReactNode;
}

/** Provider shell: header, credential provenance, error line, and content slot.
 * Every listed provider has a resolved credential — a keyless provider is never
 * rendered at all — so there is no "not configured" state here. */
export function ProviderCard({
  providerName,
  providerSlug,
  iconUrl,
  credentialSources,
  error,
  note,
  children,
}: ProviderCardProps) {
  return (
    <section className="bg-paper border border-ink/15 rounded-lg shadow-xs">
      <header className="flex items-center justify-between gap-2 px-3.5 py-2.5 border-b border-ink/10">
        <span className="flex min-w-0 items-center gap-2">
          {providerSlug && (
            <ProviderIconPlate
              provider={{ slug: providerSlug, name: providerName, ...(iconUrl ? { iconUrl } : {}) }}
              size={20}
            />
          )}
          <span className="truncate text-xs font-semibold text-ink">{providerName}</span>
        </span>
        <span
          className="text-[10px] font-mono uppercase tracking-wider text-ink/50 truncate"
          title={`Credentials from ${credentialSources.join(', ')}`}
        >
          {credentialSources.join(' · ')}
        </span>
      </header>

      <div className="p-3.5 space-y-4">
        {error && (
          <p className="flex items-start gap-2 text-error text-xs leading-relaxed">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span className="break-words">{error}</span>
          </p>
        )}
        {children}

        {note && (
          <p className="text-[10px] text-ink/50 leading-relaxed border-t border-ink/10 pt-2.5">{note}</p>
        )}
      </div>
    </section>
  );
}
