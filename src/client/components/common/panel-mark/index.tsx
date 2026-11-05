/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A PANEL's mark, wherever a panel is listed.
 *
 * The activity bar, the phone's chip strip and the Built-in list in Settings all
 * draw the same thing, and before this component each one decided its colour for
 * itself: the rail stamped the PANEL id's hue, while the two lists drew the bare
 * glyph and therefore took the GLYPH's hue — so `Files` was `hsl(0 …)` in one
 * place and `hsl(320 …)` in the other, and `Wiki`'s `BookOpen` fell through to
 * the `info` signal colour because it means something as a glyph but nothing as
 * a panel.
 *
 * Two rules, and the split between them is the point:
 *
 * - **A BUILT-IN view** takes the hue of its PANEL ID (`usePanelHues`, resolved
 *   over the whole set of built-in views so the answer cannot depend on what a
 *   surface is drawing). That is one colour per view, everywhere.
 * - **A PLUGIN panel** takes the plugin's OWN mark colour — the brand hex its
 *   manifest declares, else the hue of its name — because that is what its
 *   marketplace card draws. Keying it by the slot id instead gave one plugin two
 *   colours, which is the defect this component exists to remove.
 *
 * A declared brand colour still wins over everything: it is surfaced as the
 * `--panel-color-light`/`-dark` pair, which the stylesheet reads before the hue.
 * `data-declared` says the mark carries one, because the rail must not dim a
 * colour the plugin author chose (see `icon-paint-css.ts`).
 */

import type { ReactNode } from 'preact/compat';
import { legiblePair } from '@/shared/lib/theme/legibility';
import { hashHue, iconTone } from '@/shared/lib/icons/tint';
import { usePanelHues } from '@/client/hooks/workspace/panel-hues';
import { panelHueOf } from '@/shared/lib/workspace/panel-hues';
import { PluginMark } from '@/client/components/settings/categories/panel-plugins/PluginMark';

interface PanelMarkProps {
  /** The panel id a BUILT-IN view's hue is keyed by. */
  panelId: string;
  /**
   * Which KIND of panel this is: a built-in view takes the panel-id hue, a
   * plugin keeps its own mark colour. Stated rather than inferred from `icon`,
   * because a built-in view may have no glyph of its own and would otherwise be
   * recoloured as if it were a plugin.
   */
  builtin: boolean;
  /** A built-in view's own glyph, when it has one. */
  icon?: ReactNode;
  /** The plugin's display name; also the fallback mark when it ships no icon. */
  name: string;
  iconUrl?: string;
  /** The colour the plugin's manifest declares, when it declares one. */
  color?: string;
  size: number;
  /**
   * The mark's state, when the surface has one. `undefined` means "no state":
   * the rail is the only caller that dims an inactive mark, and it must be able
   * to say so without every other surface pretending to be inactive.
   */
  idle?: boolean;
  /** Extra classes for the wrapper — a surface's own layout, nothing about colour. */
  className?: string;
}

export function PanelMark({
  panelId,
  builtin,
  icon,
  name,
  iconUrl,
  color,
  size,
  idle,
  className,
}: PanelMarkProps) {
  const hues = usePanelHues();
  const declared = color ? legiblePair(color) : null;
  // The panel's hue, whichever family it is. A built-in view takes its id's hue
  // (resolved over the whole set, so the answer cannot depend on the surface); a
  // plugin takes the hue of its name, which is the one its own mark stamps. Both
  // then need the LIGHT TONE for that hue — the solved table, since a panel's
  // hue is only known at runtime and therefore cannot be a generated CSS row.
  const hue = builtin ? panelHueOf(hues, panelId) : hashHue(name);
  return (
    <span
      className={className ?? 'inline-flex'}
      data-panel-mark=""
      data-idle={idle === true ? '' : undefined}
      // Stamped from the DATA (`panel.color`), not guessed from the stylesheet:
      // the rail's idle filter is exempted by this attribute.
      data-declared={declared ? '' : undefined}
      style={{
        '--panel-hue': String(hue),
        '--panel-tone': iconTone(hue, 'light'),
        '--panel-tone-dark': iconTone(hue, 'dark'),
        ...(declared ? { '--panel-color-light': declared.light } : {}),
        ...(declared?.dark ? { '--panel-color-dark': declared.dark } : {}),
      }}
    >
      {icon ?? <PluginMark name={name} iconUrl={iconUrl} color={color} size={size} />}
    </span>
  );
}
