/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Settings → Appearance → Surfaces.
 *
 * Two cards, each drawn as a MINIATURE of the material rather than an icon: the
 * difference between an opaque panel and a frosted one is the only thing the
 * setting decides, so the card has to show that difference where it happens —
 * a chrome bar over a tinted ground, with the same rows inside.
 *
 * The miniature is built from the SAME tokens the product uses (`--glass-*` and
 * the palette's `text-ink/*`), never from a hex, so a card cannot promise a
 * look the shell does not ship.
 *
 * The cards are `aria-pressed` buttons rather than radios: there is no submit,
 * the choice applies on click, and `applySettingsSideEffects` is what writes the
 * document attribute — this file never touches the DOM itself, so the live
 * apply and the persisted copy cannot disagree.
 */

import type { ComponentType } from 'preact/compat';
import type { SettingsState } from '@/shared/types';
import {
  SURFACE_STYLES,
  SURFACE_STYLE_COPY,
  resolveSurfaceStyle,
  type SurfaceStyle,
} from '@/shared/lib/theme/surface-style';
import { GLASS_LIMIT_COPY } from '@/shared/lib/theme/glass-support';
import { useGlassLimits } from '@/client/hooks/ui/glass-support';

interface SurfaceStyleSectionProps {
  settings: SettingsState;
  onUpdate: (updater: Partial<SettingsState> | ((previous: SettingsState) => SettingsState)) => void;
}

/** The rows both miniatures share, so the ONLY difference is the material. */
function MiniRows() {
  return (
    <span className="flex h-full flex-col gap-1 p-1">
      <span className="flex items-center gap-1">
        <span className="h-[3px] w-[38%] rounded-full bg-ink/40" />
        <span className="ml-auto h-[6px] w-[10%] rounded-[2px] border border-ink/20" />
      </span>
      <span className="h-[2px] w-full rounded-full bg-ink/15" />
      <span className="flex items-center gap-1">
        <span className="h-[3px] w-[52%] rounded-full bg-ink/30" />
        <span className="h-[3px] w-[18%] rounded-full bg-ink/15" />
      </span>
      <span className="flex items-center gap-1">
        <span className="h-[3px] w-[44%] rounded-full bg-ink/30" />
        <span className="h-[3px] w-[22%] rounded-full bg-ink/15" />
      </span>
    </span>
  );
}

/** Opaque panels on the palette canvas. */
function ClassicMiniature() {
  return (
    <span className="block h-full rounded-md border border-ink/15 bg-paper" aria-hidden="true">
      <span className="block h-[13px] rounded-t-[5px] border-b border-ink/10 bg-paper">
        <span className="mx-1 mt-[4px] block h-[3px] w-[40%] rounded-full bg-ink/35" />
      </span>
      <MiniRows />
    </span>
  );
}

/**
 * One frosted plane over a tinted glow.
 *
 * The glow is drawn INSIDE the card's box on purpose: a full-screen app has no
 * outside for the aura to bleed into, which is why the real plane keeps its
 * blobs under its own edge instead of around it.
 */
function GlassMiniature() {
  return (
    <span className="relative block h-full overflow-hidden rounded-md border border-ink/15 bg-canvas" aria-hidden="true">
      <span className="pointer-events-none absolute inset-0">
        <span className="absolute -left-2 top-2 h-[70%] w-[55%] rounded-full bg-info/40 blur-md" />
        <span className="absolute -right-2 -top-2 h-[60%] w-[50%] rounded-full bg-meta/35 blur-md" />
        <span className="absolute -bottom-2 right-3 h-[45%] w-[45%] rounded-full bg-success/30 blur-md" />
      </span>
      <span className="relative block h-[13px] border-b border-ink/10 bg-paper/40">
        <span className="mx-1 mt-[4px] block h-[3px] w-[40%] rounded-full bg-ink/40" />
      </span>
      <span className="relative block h-[calc(100%-13px)] bg-paper/50">
        <MiniRows />
      </span>
    </span>
  );
}

const MINIATURES: Record<SurfaceStyle, ComponentType> = {
  classic: ClassicMiniature,
  glass: GlassMiniature,
};

/**
 * Why the frost is missing, when it is.
 *
 * `glass.css` falls back to opaque panels on an engine without `backdrop-filter`
 * and under `prefers-reduced-transparency`, and a CSS fallback cannot say why —
 * so a window that reports `glass` and looks `classic` is indistinguishable from
 * a broken setting. This is the one surface that can name it, in the place the
 * choice was made, and it names every reason that applies.
 */
function GlassLimits() {
  const limits = useGlassLimits();
  if (limits.length === 0) return null;
  return (
    <ul className="space-y-1 rounded-lg border border-ink/15 bg-ink/[0.03] p-2.5" aria-live="polite">
      {limits.map((limit) => (
        <li key={limit} className="flex gap-1.5 text-[11px] leading-relaxed text-ink/60">
          <span aria-hidden="true" className="mt-[5px] h-1 w-1 shrink-0 rounded-full bg-ink/40" />
          <span>{GLASS_LIMIT_COPY[limit]}</span>
        </li>
      ))}
    </ul>
  );
}

export function SurfaceStyleSection({ settings, onUpdate }: SurfaceStyleSectionProps) {
  const selected = resolveSurfaceStyle(settings.surfaceStyle);

  return (
    <section className="space-y-3">
      <div>
        <h4 className="text-xs font-semibold text-ink">Surfaces</h4>
        <p className="mt-0.5 text-[11px] text-ink/50">
          What the windows are made of. Both styles draw the same panels, rows and dialogs;
          the frost is one blur pass per window, and it follows the palette — there is no
          separate glass colour to tune.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2" role="group" aria-label="Surface style">
        {SURFACE_STYLES.map((style) => {
          const copy = SURFACE_STYLE_COPY[style];
          const isSelected = style === selected;
          const Miniature = MINIATURES[style];
          return (
            <button
              key={style}
              type="button"
              onClick={() => onUpdate({ surfaceStyle: style })}
              aria-pressed={isSelected}
              aria-label={`${copy.label} surfaces — ${copy.description}`}
              className={`flex flex-col gap-2 rounded-xl border p-2.5 text-left transition-colors cursor-pointer ${
                isSelected
                  ? 'border-ink/40 bg-ink/5'
                  : 'border-ink/15 bg-paper hover:border-ink/30 hover:bg-ink/5'
              }`}
            >
              <span className="block h-[78px]">
                <Miniature />
              </span>
              <span className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-ink">{copy.label}</span>
                <span className="font-mono text-[10px] text-ink/40">{copy.caption}</span>
                {isSelected && (
                  <span className="ml-auto rounded-full bg-ink px-1.5 py-[1px] text-[9px] font-semibold text-paper">
                    active
                  </span>
                )}
              </span>
              <span className="text-[11px] leading-relaxed text-ink/60">{copy.description}</span>
            </button>
          );
        })}
      </div>

      {selected === 'glass' && <GlassLimits />}
    </section>
  );
}
