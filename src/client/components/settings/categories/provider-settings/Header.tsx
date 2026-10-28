import { RefreshCw } from 'lucide-preact';
import type { ProviderItem } from '@/shared/types';
import { ProviderIconPlate } from '@/client/components/common/provider-icon/Plate';

interface ProviderHeaderProps {
  provider: ProviderItem;
  /** Refetch the provider's web icon from its own site. */
  onRefreshIcon?: () => void;
  /** True while that fetch is in flight. */
  isRefreshingIcon?: boolean;
}

/**
 * The provider's identity block.
 *
 * The name and the slug are ONE column beside the plate rather than two stacked
 * blocks, because the stacked form aligned the slug with a hard-coded `pl-8` —
 * which only matched while the mark happened to be exactly 32px wide. The
 * initials fallback is a pill whose width follows its text, so on a provider
 * without a brand mark the slug sat a few pixels off its own title. A flex row
 * makes the shared left edge a consequence of the layout instead of arithmetic.
 *
 * The refresh control exists because the fetched icon is cached for a week: a
 * gateway that renames itself, or a site that ships a new logo, would otherwise
 * keep the old picture with nothing on screen to say why.
 */
export function ProviderHeader({ provider, onRefreshIcon, isRefreshingIcon = false }: ProviderHeaderProps) {
  return (
    <div className="flex items-start gap-3 pb-4">
      <ProviderIconPlate provider={provider} size={30} className="mt-0.5" />
      <div className="min-w-0 flex flex-1 flex-col gap-0.5">
        <h2 className="text-xl font-bold leading-tight tracking-tight text-ink truncate">
          {provider.name}
        </h2>
        <p className="text-xs font-mono text-ink/50 truncate">{provider.slug}</p>
      </div>
      {onRefreshIcon && (
        <button
          type="button"
          onClick={onRefreshIcon}
          disabled={isRefreshingIcon}
          title={provider.baseUrl
            ? `Refetch the icon from ${provider.baseUrl}`
            : 'This provider has no endpoint to read an icon from'}
          aria-label="Refresh provider icon"
          className="shrink-0 p-1.5 rounded-md border border-ink/15 text-ink/50 hover:text-ink hover:bg-ink/5 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <RefreshCw size={12} className={isRefreshingIcon ? 'animate-spin' : ''} />
        </button>
      )}
    </div>
  );
}
