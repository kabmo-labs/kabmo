/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Settings → Appearance → Palette.
 *
 * The app palette, and nothing else: the grid is 42 cards with its own light /
 * dark filter, so this file is the section heading around it. It exists as a
 * section rather than inline markup because every other group's sections are
 * components with a heading, and a first group that was the odd one out would
 * be the file that has to change when the next section is added.
 */

import type { SettingsState } from '@/shared/types';
import { resolveThemeId } from '@/shared/lib/theme/catalog';
import { ThemeGrid } from '@/client/components/settings/categories/appearance-settings/ThemeGrid';

interface ThemeSectionProps {
  settings: SettingsState;
  onUpdate: (updater: Partial<SettingsState> | ((prev: SettingsState) => SettingsState)) => void;
}

export function ThemeSection({ settings, onUpdate }: ThemeSectionProps) {
  return (
    <section className="space-y-3">
      <div>
        <h4 className="text-sm font-semibold text-ink">Console palette</h4>
        <p className="mt-0.5 text-[11px] text-ink/60">
          The colours every surface, row and dialog is painted from. The code editor has its own theme,
          in the Editor group.
        </p>
      </div>

      <ThemeGrid
        selectedId={settings.theme}
        onSelect={(theme) => onUpdate({ theme: resolveThemeId(theme) })}
      />
    </section>
  );
}
