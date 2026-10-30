/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The one reader/writer of the composer's style.
 *
 * A style picks a ROW ORDER and a frame, so something in JavaScript must
 * re-render when it changes — `appSettings` is a boot-time prop and would only
 * show a new style after a reload. The settings modal calls `applyComposerStyle`
 * when the value moves, which announces `omp:composer-style-changed`;
 * `useComposerStyle` is the single subscriber and the composer is its only
 * consumer.
 *
 * The initial value comes from the primed settings snapshot
 * (`primeKabmoSettings` in `main.tsx`), so a mounted composer draws the stored
 * style on its first render — no flash of the other order.
 */

import { useState } from 'preact/hooks';
import { readKabmoSetting } from '@/shared/lib/settings/client';
import { useKabmoEvent } from '@/client/hooks/ui/window-event';
import type { SettingsState } from '@/shared/types';
import {
  resolveComposerStyle,
  type ComposerStyle,
} from '@/shared/lib/chat/composer/style';

/**
 * `app_settings` key holding the style (in the `kabmo_settings` blob).
 *
 * `satisfies keyof SettingsState` because the key and the field name must be
 * the same string for persistence to work at all — renaming the field without
 * this line would leave the setting silently unsaved.
 */
export const COMPOSER_STYLE_SETTING_KEY = 'composerStyle' satisfies keyof SettingsState;

/** Window event carrying the resolved style as `detail`. */
export const COMPOSER_STYLE_CHANGED_EVENT = 'omp:composer-style-changed';

/** The stored style, resolved against what this build can draw. */
export function currentComposerStyle(appSettings?: Record<string, any>): ComposerStyle {
  return resolveComposerStyle(readKabmoSetting<unknown>(COMPOSER_STYLE_SETTING_KEY, appSettings));
}

/**
 * Announce a new style. Called by the settings modal when the value changes —
 * the persisted copy is written by the modal's own `writeKabmoSettings`, so
 * this function only has to make the mounted composer re-render.
 */
export function applyComposerStyle(style: unknown): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(COMPOSER_STYLE_CHANGED_EVENT, { detail: resolveComposerStyle(style) }),
  );
}

/** The style the composer should draw, kept live across settings edits. */
export function useComposerStyle(): ComposerStyle {
  const [style, setStyle] = useState<ComposerStyle>(() => currentComposerStyle());
  useKabmoEvent(COMPOSER_STYLE_CHANGED_EVENT, (event) => {
    setStyle(resolveComposerStyle((event as CustomEvent<unknown>).detail));
  });
  return style;
}
