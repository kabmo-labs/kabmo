/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One theme as a palette card: the name, a light/dark badge, and the eight
 * colors the theme actually paints with — canvas, surface, ink, error, success,
 * info, warning and accent.
 *
 * The chips are the palette's own hex values, not the live CSS variables, so
 * the card shows what selecting it will do rather than what is currently on
 * screen. Hovering a chip names its role; the two surface colors carry the
 * card's frame, which is why they lead the strip.
 */

import { Check } from 'lucide-preact';
import type { ThemePalette } from '@/shared/types/theme';
import { THEME_SWATCHES } from '@/shared/lib/theme/catalog';

interface ThemeCardProps {
  theme: ThemePalette;
  selected: boolean;
  onSelect: (id: string) => void;
}

export function ThemeCard({ theme, selected, onSelect }: ThemeCardProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(theme.id)}
      aria-pressed={selected}
      className={`group flex w-full flex-col gap-2.5 rounded-lg border p-2.5 text-left transition-all cursor-pointer ${
        selected
          ? 'border-ink bg-ink/5 ring-1 ring-ink/20'
          : 'border-ink/20 bg-paper hover:border-ink/40 hover:bg-ink/5'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="truncate font-semibold text-ink" title={theme.name}>
          {theme.name}
        </span>
        <span className="shrink-0 rounded-full border border-ink/15 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-ink/50">
          {theme.variant}
        </span>
        {selected && <Check size={14} className="ml-auto shrink-0 text-ink" />}
      </div>

      <div className="flex items-center gap-1">
        {THEME_SWATCHES.map((swatch) => (
          <span
            key={swatch.key}
            title={`${swatch.label} · ${theme[swatch.key]}`}
            style={{ backgroundColor: theme[swatch.key] }}
            className="h-5 flex-1 rounded-[3px] border border-ink/10"
          />
        ))}
      </div>
    </button>
  );
}
