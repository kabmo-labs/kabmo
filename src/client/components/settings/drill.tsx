/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The drilled screen a settings category is showing on a PHONE, published to
 * the sheet's ONE header band.
 *
 * A category that is two panes on a desktop is two screens on a phone, and the
 * sheet's category list is a third level. Each level used to draw its own back
 * control and its own title band, and they STACKED: measured at 390x844 on
 * Settings → Appearance → Palette, the sheet's band said "Appearance" with a
 * chevron, a 35px bar under it said "‹ Appearance settings", and a third 64px
 * band said "Palette" — 163px, ~19% of the screen, on three rows that each meant
 * "go back", two of which did it.
 *
 * So there is ONE band (`Band.tsx`), owned by the sheet, and a category tells it
 * what the current screen is called and how to leave it. The registration is
 * cleared on unmount, so switching category cannot leave the previous
 * category's back control in the band. Nothing registers on a desktop, where
 * both panes are visible at once and the band keeps naming the category.
 */

import { createContext } from 'preact';
import { useContext, useEffect, useMemo, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';

/** One drilled screen, as the band needs to draw it. */
export interface SettingsDrill {
  /** What this screen is called. */
  label: string;
  /** One line under the label, when the screen has its own. */
  description?: string;
  /** Leaves this screen for the one it was opened from. */
  back: () => void;
  /** Accessible name for that control — "Back to Appearance settings". */
  backLabel: string;
}

/** The sheet's collector: a registration, or a clear. */
export type RegisterDrill = (drill: SettingsDrill | null) => void;

const DrillContext = createContext<RegisterDrill | null>(null);

/** Holds the drilled screen for one sheet. `children` is the whole sheet. */
export function SettingsDrillProvider({
  register,
  children,
}: {
  register: RegisterDrill;
  children: ComponentChildren;
}) {
  return <DrillContext.Provider value={register}>{children}</DrillContext.Provider>;
}

/**
 * Publish (or clear) this screen for as long as it is mounted.
 *
 * An EFFECT, not a render-time call: the setter writes the sheet's state, and a
 * child writing its parent's state during render is the one thing Preact will
 * not settle. The dependency list names the FIELDS rather than the object, so a
 * caller building the literal inline does not re-register on every render.
 */
export function useSettingsDrill(drill: SettingsDrill | null): void {
  const register = useContext(DrillContext);
  const label = drill?.label;
  const description = drill?.description;
  const back = drill?.back;
  const backLabel = drill?.backLabel;
  useEffect(() => {
    if (!register) return;
    if (!label || !back || !backLabel) {
      register(null);
      return;
    }
    register({ label, description, back, backLabel });
    return () => register(null);
  }, [register, label, description, back, backLabel]);
}

/**
 * The band's source of truth.
 *
 * A hook rather than a component, because the sheet already owns its band's
 * markup and only needs to know what to put in it. The setter is stable and
 * skips a write that would not change the band, so a re-registering pane cannot
 * loop.
 */
export function useSettingsDrillState(): {
  register: RegisterDrill;
  drill: SettingsDrill | null;
} {
  const [drill, setDrill] = useState<SettingsDrill | null>(null);
  const register = useMemo<RegisterDrill>(
    () => (next) =>
      setDrill((current) => {
        if (next === null) return current === null ? current : null;
        if (
          current &&
          current.label === next.label &&
          current.description === next.description &&
          current.back === next.back &&
          current.backLabel === next.backLabel
        ) {
          return current;
        }
        return next;
      }),
    [],
  );
  return { register, drill };
}
