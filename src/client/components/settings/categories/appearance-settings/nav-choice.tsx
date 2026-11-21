/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One navigation choice as a pair of cards, and the words each one uses.
 *
 * Extracted from `PanelNavSection` when the phone got a second drawer: the
 * section now renders four groups (two desktop columns, two phone drawers) and
 * the card markup is identical for all of them, so a copy per group would be
 * four places for the "active" badge to drift.
 *
 * The copy tables stay here, beside the component that reads them, and are keyed
 * by the STYLE rather than by side: the phone's two drawers differ only in the
 * one sentence that says what its strip leads with.
 */

import type { ComponentChildren } from 'preact';
import {
  MOBILE_PANEL_NAVS,
  PANEL_NAV_COPY,
  PANEL_NAV_STYLES,
  type MobilePanelNav,
  type PanelNavStyle,
} from '@/shared/lib/workspace/panel-nav';
import {
  ClassicDrawerMiniature,
  RailMiniature,
  TabsDrawerMiniature,
  TabsMiniature,
} from '@/client/components/settings/categories/appearance-settings/nav-miniatures';

/** The drawing each desktop style is shown as. */
function desktopMiniature(style: PanelNavStyle): ComponentChildren {
  return style === 'rail' ? <RailMiniature /> : <TabsMiniature />;
}

/**
 * The phone's copy, kept apart from the desktop table: the words "rail" and
 * "column" would be wrong for a drawer that has neither.
 */
const MOBILE_COPY: Record<MobilePanelNav, { label: string; description: string; caption: string }> = {
  classic: {
    label: 'Classic',
    description: 'The strip lists every view; tapping one swaps the drawer body.',
    caption: 'All views · one tap',
  },
  tabs: {
    label: 'Tabs',
    description:
      'The strip holds only the views you opened, over a home page that lists them all. The drawer reopens where you left it.',
    caption: 'Opened views · home page',
  },
};

/**
 * The LEFT drawer's own words.
 *
 * It differs from the right in one fact the user must be told: the session list
 * is a PINNED chip under `tabs`, so the drawer cannot be closed down to a home
 * page with no way back to another chat. Saying it in the card is cheaper than
 * discovering it.
 */
const MOBILE_LEFT_COPY: Record<MobilePanelNav, { label: string; description: string; caption: string }> = {
  classic: {
    label: 'Classic',
    description: 'The strip lists every view the left dock holds; tapping one swaps the drawer body.',
    caption: 'All views · one tap',
  },
  tabs: {
    label: 'Tabs',
    description:
      'The strip holds the views you opened, with Sessions pinned first, over a home page that lists the rest. The drawer reopens where you left it.',
    caption: 'Opened views · Sessions pinned',
  },
};

interface ChoiceProps<T extends string> {
  styles: readonly T[];
  copy: Record<T, { label: string; description: string; caption: string }>;
  /** The drawing for one style. A FUNCTION, not a component map: one drawing
      takes a prop (the pinned chip), and a map of `ComponentType` cannot carry
      per-entry props without widening to `any`. */
  miniature: (style: T) => ComponentChildren;
  current: T;
  onPick: (style: T) => void;
  /** The group's accessible name — "Panel navigation", "Phone left drawer". */
  label: string;
}

function NavChoice<T extends string>({ styles, copy, miniature, current, onPick, label }: ChoiceProps<T>) {
  return (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2" role="group" aria-label={label}>
      {styles.map((style) => {
        const text = copy[style];
        const isSelected = style === current;
        return (
          <button
            key={style}
            type="button"
            onClick={() => onPick(style)}
            aria-pressed={isSelected}
            aria-label={`${text.label} — ${text.description}`}
            className={`flex cursor-pointer flex-col gap-2 rounded-xl border p-2.5 text-left transition-colors ${
              isSelected
                ? 'border-ink/40 bg-ink/5'
                : 'border-ink/15 bg-paper hover:border-ink/30 hover:bg-ink/5'
            }`}
          >
            <span className="block h-[54px]">{miniature(style)}</span>
            <span className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-ink">{text.label}</span>
              <span className="font-mono text-[10px] text-ink/40">{text.caption}</span>
              {isSelected && (
                <span className="ml-auto rounded-full bg-ink px-1.5 py-[1px] text-[10px] font-semibold text-paper">
                  active
                </span>
              )}
            </span>
            <span className="text-[11px] leading-relaxed text-ink/60">{text.description}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The desktop columns' choice — `rail` or `tabs`. */
export function PanelNavChoice({
  current,
  onPick,
}: {
  current: PanelNavStyle;
  onPick: (style: PanelNavStyle) => void;
}) {
  return (
    <NavChoice
      styles={PANEL_NAV_STYLES}
      copy={PANEL_NAV_COPY}
      miniature={desktopMiniature}
      current={current}
      onPick={onPick}
      label="Panel navigation"
    />
  );
}

/** A phone drawer's choice — `classic` or `tabs`, with that drawer's words. */
export function MobileNavChoice({
  side,
  current,
  onPick,
}: {
  side: 'left' | 'right';
  current: MobilePanelNav;
  onPick: (style: MobilePanelNav) => void;
}) {
  const pinned = side === 'left';
  return (
    <NavChoice
      styles={MOBILE_PANEL_NAVS}
      copy={pinned ? MOBILE_LEFT_COPY : MOBILE_COPY}
      miniature={(style) =>
        style === 'classic' ? (
          <ClassicDrawerMiniature />
        ) : (
          <TabsDrawerMiniature pinned={pinned} />
        )
      }
      current={current}
      onPick={onPick}
      label={pinned ? 'Phone left drawer' : 'Phone right drawer'}
    />
  );
}
