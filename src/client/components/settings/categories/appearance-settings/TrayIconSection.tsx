/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Settings → Appearance → Layout → Tray icon.
 *
 * The tray is a SYSTEM surface, so this is a separate choice from the in-app
 * icon style: a monochrome menu-bar glyph beside full-colour console marks is
 * the macOS convention, and it is what keeps a coloured square from sitting
 * among the system's own status items.
 *
 * The previews are the two things the setting actually swaps: the shipped app
 * icon (read from `public/icon.svg`, the same file the tray loads) and the K
 * mark alone in the palette ink. Neither preview is rendered through the live
 * tray — that is a separate process — so the cards show the artwork, not a
 * promise about a host this page cannot reach.
 */

import type { ComponentType } from 'preact/compat';
import type { SettingsState } from '@/shared/types';
import { resolveTheme } from '@/shared/lib/theme/catalog';
import {
  TRAY_ICON_STYLES,
  TRAY_ICON_STYLE_COPY,
  resolveTrayIconStyle,
  type TrayIconStyle,
} from '@/shared/lib/theme/tray-icon-style';

interface TrayIconSectionProps {
  settings: SettingsState;
  onUpdate: (updater: Partial<SettingsState> | ((previous: SettingsState) => SettingsState)) => void;
}

/** The shipped app icon, plate and all — the same file the tray loads. */
function ColorMiniature() {
  return (
    <span className="flex h-full items-center justify-center rounded-md border border-ink/10 bg-canvas/60">
      <img src="/icon.svg" alt="" width={26} height={26} className="rounded-[6px]" aria-hidden="true" />
    </span>
  );
}

/** The greyscale plate for the active theme's variant — the file the tray loads. */
function MonochromeMiniature({ variant }: { variant: 'light' | 'dark' }) {
  return (
    <span className="flex h-full items-center justify-center rounded-md border border-ink/10 bg-canvas/60">
      <img
        src={`/tray-monochrome-${variant}.png`}
        alt=""
        width={26}
        height={26}
        aria-hidden="true"
      />
    </span>
  );
}

export function TrayIconSection({ settings, onUpdate }: TrayIconSectionProps) {
  const selected = resolveTrayIconStyle(settings.trayIconStyle);
  const variant = resolveTheme(settings.theme).variant;
  const MINIATURES: Record<TrayIconStyle, ComponentType> = {
    color: ColorMiniature,
    monochrome: () => <MonochromeMiniature variant={variant} />,
  };

  return (
    <section className="space-y-3">
      <div>
        <h4 className="text-sm font-semibold text-ink">Tray icon</h4>
        <p className="mt-0.5 text-[11px] text-ink/60">
          The menu-bar (macOS) or notification-area (Windows, Linux) icon. Full colour is the
          shipped app icon, orange arm and all; monochrome is a greyscale conversion: the green
          plate and the cream strokes swap luminance with the theme, and the orange arm becomes
          the middle grey. Applies the next time the tray starts, or immediately when it is
          already running.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2" role="group" aria-label="Tray icon style">
        {TRAY_ICON_STYLES.map((style) => {
          const copy = TRAY_ICON_STYLE_COPY[style];
          const isSelected = style === selected;
          const MiniatureView = MINIATURES[style];
          return (
            <button
              key={style}
              type="button"
              onClick={() => onUpdate({ trayIconStyle: style })}
              aria-pressed={isSelected}
              aria-label={`${copy.label} tray icon — ${copy.description}`}
              className={`flex flex-col gap-2 rounded-xl border p-2.5 text-left transition-colors cursor-pointer ${
                isSelected
                  ? 'border-ink/40 bg-ink/5'
                  : 'border-ink/15 bg-paper hover:border-ink/30 hover:bg-ink/5'
              }`}
            >
              <span className="block h-[42px]">
                <MiniatureView />
              </span>
              <span className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-ink">{copy.label}</span>
                <span className="font-mono text-[10px] text-ink/40">{copy.caption}</span>
                {isSelected && (
                  <span className="ml-auto rounded-full bg-ink px-1.5 py-[1px] text-[10px] font-semibold text-paper">
                    active
                  </span>
                )}
              </span>
              <span className="text-[11px] leading-relaxed text-ink/60">{copy.description}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
