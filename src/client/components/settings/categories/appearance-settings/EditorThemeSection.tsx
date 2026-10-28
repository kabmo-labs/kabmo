/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The code editor's colour theme, as a filterable grid of cards.
 *
 * A second axis beside the app palette (see `themes.ts`): the console keeps its
 * own theme and the editor wears whichever TextMate theme the reader works in.
 * `auto` is the first card and the default, so an install that never opens this
 * picker behaves exactly as before.
 *
 * Three properties are load-bearing and each is a bug if dropped:
 *
 * - **The swatch is drawn from the generated colour rows, not from the theme
 *   module.** 65 TextMate definitions is 1.3 MB; a grid that fetched them to
 *   draw itself would download the whole catalogue to show a colour. The rows
 *   carry the surface, the ink and three syntax accents — the colours that
 *   actually tell two themes apart at card size.
 * - **The preview is set in the theme's OWN colours**, so an unselected card
 *   still shows what selecting it does.
 * - **Selecting is a write, and the write is announced** (`Modal` dispatches
 *   `omp:editor-theme-changed`), which is what reaches an editor that is
 *   already open — `appSettings` is a boot-time prop and would only apply on a
 *   reload.
 */

import { useMemo, useState } from 'preact/hooks';
import { Check, Moon, Palette, Sun } from 'lucide-preact';
import type { SettingsState } from '@/shared/types';
import {
  EDITOR_AUTO_THEME_ID,
  EDITOR_THEMES,
  type EditorTheme,
} from '@/shared/lib/code/editor/themes';
import { EDITOR_FONT_CHOICES } from '@/shared/lib/code/editor/typography';

interface EditorThemeSectionProps {
  settings: SettingsState;
  onUpdate: (updater: Partial<SettingsState> | ((prev: SettingsState) => SettingsState)) => void;
}

type VariantFilter = 'all' | 'light' | 'dark';

const FILTERS: ReadonlyArray<{ id: VariantFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

/** The face the cards' sample line is set in: the editor's own choice. */
function sampleFace(font: string): string {
  const choice = EDITOR_FONT_CHOICES.find((entry) => entry.id === font);
  return `"${choice?.id ?? EDITOR_FONT_CHOICES[0].id}", monospace`;
}

function ThemeSwatch({ theme, face }: { theme: EditorTheme; face: string }) {
  return (
    <span
      className="block overflow-hidden rounded border border-ink/10"
      style={{ backgroundColor: theme.bg, color: theme.fg }}
    >
      <span className="block px-1.5 py-1 font-mono text-[10px] leading-[1.4]" style={{ fontFamily: face }}>
        <span style={{ color: theme.keyword }}>const</span> <span>answer</span>{' '}
        <span style={{ color: theme.keyword }}>=</span> <span style={{ color: theme.string }}>42</span>
        <span>{';'}</span>
        <span className="block truncate" style={{ color: theme.comment }}>
          {'// '}
          {theme.label}
        </span>
      </span>
    </span>
  );
}

export function EditorThemeSection({ settings, onUpdate }: EditorThemeSectionProps) {
  const active = settings.editorTheme || EDITOR_AUTO_THEME_ID;
  const [filter, setFilter] = useState<VariantFilter>('all');
  const face = sampleFace(settings.editorFont);

  const themes = useMemo(
    () => (filter === 'all' ? EDITOR_THEMES : EDITOR_THEMES.filter((theme) => theme.variant === filter)),
    [filter],
  );

  return (
    <section className="space-y-3">
      <div>
        <h3 className="font-semibold text-sm uppercase tracking-wider text-ink/80 flex items-center gap-2">
          <Palette size={16} className="text-ink/60" />
          Editor Theme
        </h3>
        <p className="text-[11px] text-ink/60 mt-1">
          Colours for the code editor only — the console around it keeps the theme above. <strong>Auto</strong>{' '}
          follows the app palette; any other choice paints the editor's own surface, gutter, selection and
          syntax, and applies to every open editor without a reload.
        </p>
      </div>

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
        <span className="ml-auto font-mono text-[11px] text-ink/50">
          {filter === 'all' ? `${themes.length} themes` : `${themes.length} shown`}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {/* `Auto` is a card rather than a checkbox: it is one of the choices,
            and a checkbox beside a grid makes the default look like an
            override of the thing it is a peer of. It is drawn under EVERY
            filter — it is neither light nor dark, and a user who filtered to
            Dark must still be able to get back to the app palette without
            first clearing the filter. */}
        {(
          <button
            type="button"
            onClick={() => onUpdate({ editorTheme: EDITOR_AUTO_THEME_ID })}
            aria-pressed={active === EDITOR_AUTO_THEME_ID}
            className={`flex w-full flex-col gap-2 rounded-lg border p-2 text-left transition-colors cursor-pointer ${
              active === EDITOR_AUTO_THEME_ID
                ? 'border-ink bg-ink/5 ring-1 ring-ink/20'
                : 'border-ink/20 bg-paper hover:border-ink/40 hover:bg-ink/5'
            }`}
          >
            <span className="flex items-center gap-2">
              <span className="truncate font-semibold text-ink">Auto</span>
              <span className="shrink-0 rounded-full border border-ink/15 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-ink/50">
                app palette
              </span>
              {active === EDITOR_AUTO_THEME_ID && <Check size={14} className="ml-auto shrink-0 text-ink" />}
            </span>
            <span className="flex h-8 items-center justify-center rounded border border-dashed border-ink/20 text-[10px] text-ink/50">
              Follows the theme above
            </span>
          </button>
        )}

        {themes.map((theme) => {
          const selected = active === theme.id;
          return (
            <button
              key={theme.id}
              type="button"
              onClick={() => onUpdate({ editorTheme: theme.id })}
              aria-pressed={selected}
              className={`flex w-full flex-col gap-2 rounded-lg border p-2 text-left transition-colors cursor-pointer ${
                selected
                  ? 'border-ink bg-ink/5 ring-1 ring-ink/20'
                  : 'border-ink/20 bg-paper hover:border-ink/40 hover:bg-ink/5'
              }`}
            >
              <span className="flex items-center gap-2">
                <span className="truncate font-semibold text-ink" title={theme.label}>
                  {theme.label}
                </span>
                <span className="shrink-0 rounded-full border border-ink/15 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-ink/50">
                  {theme.variant}
                </span>
                {selected && <Check size={14} className="ml-auto shrink-0 text-ink" />}
              </span>
              <ThemeSwatch theme={theme} face={face} />
            </button>
          );
        })}
      </div>
    </section>
  );
}
