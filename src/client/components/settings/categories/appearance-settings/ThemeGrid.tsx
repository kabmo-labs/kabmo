/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The theme catalog as a filterable grid of palette cards.
 *
 * Two axes of grouping, both from the catalog: the light/dark filter narrows
 * what is shown, and the family grouping keeps a theme's light and dark entries
 * adjacent (`Nord` and `Nord` rather than `Nord` and `Monokai`). The filter is
 * local state — it changes nothing about the app, only what the grid lists.
 */

import { useMemo, useState } from 'preact/hooks';
import { Moon, Sun } from 'lucide-preact';
import type { ThemePalette, ThemeVariant } from '@/shared/types/theme';
import { THEMES } from '@/shared/lib/theme/catalog';
import { ThemeCard } from '@/client/components/settings/categories/appearance-settings/ThemeCard';

interface ThemeGridProps {
  selectedId: string;
  onSelect: (id: string) => void;
}

type VariantFilter = 'all' | ThemeVariant;

const FILTERS: ReadonlyArray<{ id: VariantFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

/**
 * Catalog order is already family-grouped (see `catalog.ts`), so filtering is a
 * plain pass — a second grouping step here would only risk disagreeing with it.
 */
function filterThemes(filter: VariantFilter): readonly ThemePalette[] {
  return filter === 'all' ? THEMES : THEMES.filter((theme) => theme.variant === filter);
}

export function ThemeGrid({ selectedId, onSelect }: ThemeGridProps) {
  const [filter, setFilter] = useState<VariantFilter>('all');
  const themes = useMemo(() => filterThemes(filter), [filter]);

  return (
    <div className="space-y-3 pb-6">
      <div className="flex items-center gap-1.5">
        {FILTERS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setFilter(option.id)}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer ${
              filter === option.id
                ? 'border-ink bg-ink text-paper'
                : 'border-ink/20 bg-paper text-ink/70 hover:border-ink/40 hover:text-ink'
            }`}
          >
            {option.id === 'light' && <Sun size={11} className="mr-1 inline align-[-1px]" />}
            {option.id === 'dark' && <Moon size={11} className="mr-1 inline align-[-1px]" />}
            {option.label}
          </button>
        ))}
        <span className="ml-auto font-mono text-[11px] text-ink/50">{themes.length} themes</span>
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {themes.map((theme) => (
          <ThemeCard
            key={theme.id}
            theme={theme}
            selected={theme.id === selectedId}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}
