/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The settings sheet's ONE header band, on every width.
 *
 * It used to be drawn three times on a phone: the sheet's own bar, the
 * master/detail shell's back bar, and the drilled pane's band. Measured at
 * 390x844 on Settings → Appearance → Palette those three were 64px, 35px and
 * 64px — 163px, ~19% of the screen, spent on three rows that each meant "go
 * back", two of which did it. The band is now the only chrome above a pane: the
 * sheet renders it, and a drilled pane registers what it should say
 * (`settings/drill.tsx`).
 *
 * The BACK control is the band's leading slot, so it sits where a phone user
 * reaches for it and where every other drilled screen in the app puts it. It is
 * drawn only while there is somewhere to go: the category list is the sheet's
 * root, so a back control there would be a control that does nothing.
 */

import { ChevronLeft, X } from 'lucide-preact';
import { SETTINGS_BAND, SETTINGS_BAND_HEIGHT_INSET } from '@/client/components/settings/pane-header';

interface SettingsBandProps {
  /** The screen on display: a category, or the drilled group inside it. */
  label: string;
  /** The one line under it, when the screen has one. */
  description?: string;
  /** Leave the drilled screen; absent on the sheet's root. */
  onBack?: () => void;
  /** Accessible name for that control. */
  backLabel?: string;
  onClose: () => void;
  /** The root's own label ("Settings") is a wordmark, not a category title. */
  root?: boolean;
}

export function SettingsBand({
  label,
  description,
  onBack,
  backLabel = 'Back',
  onClose,
  root = false,
}: SettingsBandProps) {
  return (
    <div
      className={`${SETTINGS_BAND} justify-between px-4 md:px-6`}
      style={{
        height: SETTINGS_BAND_HEIGHT_INSET,
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingLeft: 'max(1rem, env(safe-area-inset-left, 0px))',
        paddingRight: 'max(1rem, env(safe-area-inset-right, 0px))',
      }}
    >
      <div className="flex items-center gap-2 min-w-0">
        {/* One back control for the whole sheet. `md:hidden` because a desktop
            shows both panes at once, so there is no screen to leave. */}
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label={backLabel}
            className="md:hidden -ml-2 p-1.5 rounded-lg hover:bg-ink/5 active:bg-ink/10 text-ink flex-shrink-0"
          >
            <ChevronLeft size={20} />
          </button>
        ) : null}

        <div className="truncate">
          <h3
            className={`font-semibold tracking-tight text-ink leading-tight ${
              root ? 'text-sm' : 'text-base'
            }`}
          >
            {label}
          </h3>
          {description ? (
            <p className="text-[11px] text-ink/60 truncate hidden sm:block">{description}</p>
          ) : null}
        </div>
      </div>

      <button
        type="button"
        onClick={onClose}
        className="p-1.5 rounded-lg text-ink/50 hover:text-ink hover:bg-ink/5 transition-colors cursor-pointer flex-shrink-0"
        aria-label="Close settings"
      >
        <X size={18} strokeWidth={2.2} />
      </button>
    </div>
  );
}
