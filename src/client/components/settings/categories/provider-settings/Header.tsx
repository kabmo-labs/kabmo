import type { ProviderItem } from '@/shared/types';
import { ProviderIconPlate } from '@/client/components/settings/categories/provider-settings/IconPlate';

interface ProviderHeaderProps {
  provider: ProviderItem;
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
 */
export function ProviderHeader({ provider }: ProviderHeaderProps) {
  return (
    <div className="flex items-start gap-3 pb-4">
      <ProviderIconPlate provider={provider} size={30} className="mt-0.5" />
      <div className="min-w-0 flex flex-col gap-0.5">
        <h2 className="text-xl font-bold leading-tight tracking-tight text-ink truncate">
          {provider.name}
        </h2>
        <p className="text-xs font-mono text-ink/50 truncate">{provider.slug}</p>
      </div>
    </div>
  );
}
