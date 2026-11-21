/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Settings → Appearance → Desktop panels → Panel navigation.
 *
 * TWO controls, one per column, because the columns answer different questions:
 * the left is the session list plus whatever the user placed there, the right is
 * a working set that is opened and closed all day. A single shared value would
 * force one column's best shape on the other.
 *
 * The drawing in each card is a MINIATURE of the real column — a rail of marks
 * beside a list, or a strip of chips over a card grid — because "rail" and
 * "tabs" are words the user has to translate into a picture they have seen. The
 * miniature is drawn from tokens only (`bg-ink/10`, `text-ink/40`), so it follows
 * the palette like everything else.
 *
 * Each group is a pair of `aria-pressed` buttons rather than radios in a form:
 * there is no submit, the choice applies on click, and `onUpdate` is what
 * persists it. `applyPanelNav` is called by the parent's update path, so the
 * live apply and the stored copy cannot disagree.
 *
 * The phone is deliberately out of scope and says so: it has one drawer per
 * side and already draws a chip strip, so a rail in a drawer would be a second
 * 44px of chrome and the tab style would be a second chip strip beside the one
 * it has.
 */

import type { ComponentType } from 'preact/compat';
import type { SettingsState } from '@/shared/types';
import {
  MOBILE_RIGHT_PANEL_NAVS,
  PANEL_NAV_COPY,
  PANEL_NAV_STYLES,
  resolveMobileRightPanelNav,
  resolvePanelNav,
  type MobileRightPanelNav,
  type PanelNavStyle,
} from '@/shared/lib/workspace/panel-nav';

interface PanelNavSectionProps {
  settings: SettingsState;
  onUpdate: (updater: Partial<SettingsState> | ((previous: SettingsState) => SettingsState)) => void;
}

/** A rail of marks beside a list — the shape the left column ships today. */
function RailMiniature() {
  return (
    <span className="flex h-full gap-1 rounded-md border border-ink/10 bg-paper p-1" aria-hidden="true">
      <span className="flex w-[9px] flex-col items-center gap-1 border-r border-ink/10 pr-1">
        <span className="h-[5px] w-[5px] rounded-sm bg-ink/70" />
        <span className="h-[5px] w-[5px] rounded-sm bg-ink/25" />
        <span className="h-[5px] w-[5px] rounded-sm bg-ink/25" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="h-[3px] w-[46%] rounded-full bg-ink/45" />
        <span className="h-[3px] w-[62%] rounded-full bg-ink/25" />
        <span className="h-[3px] w-[54%] rounded-full bg-ink/25" />
        <span className="h-[3px] w-[40%] rounded-full bg-ink/20" />
      </span>
    </span>
  );
}

/** A strip of chips over a card grid — the browser-style column. */
function TabsMiniature() {
  return (
    <span className="flex h-full flex-col gap-1 rounded-md border border-ink/10 bg-paper p-1" aria-hidden="true">
      <span className="flex items-center gap-1 border-b border-ink/10 pb-1">
        <span className="h-[6px] w-[6px] rounded-sm border border-ink/20" />
        <span className="h-[6px] w-[28%] rounded-sm bg-ink/70" />
        <span className="h-[6px] w-[24%] rounded-sm border border-ink/20" />
      </span>
      <span className="flex gap-1">
        <span className="h-[16px] w-[22%] rounded border border-ink/15" />
        <span className="h-[16px] w-[22%] rounded border border-ink/15" />
        <span className="h-[16px] w-[22%] rounded border border-ink/15" />
      </span>
    </span>
  );
}

const MINIATURES: Record<PanelNavStyle, ComponentType> = {
  rail: RailMiniature,
  tabs: TabsMiniature,
};

/**
 * The phone's copy, kept apart from the desktop table: the words "rail" and
 * "column" would be wrong for a drawer that has neither.
 */
const MOBILE_COPY: Record<MobileRightPanelNav, { label: string; description: string; caption: string }> = {
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

/** A drawer of chips over a long list — the phone today. */
function ClassicDrawerMiniature() {
  return (
    <span className="flex h-full flex-col gap-1 rounded-md border border-ink/10 bg-paper p-1" aria-hidden="true">
      <span className="flex h-[7px] items-center gap-1 border-b border-ink/10 pb-1">
        <span className="h-[6px] w-[16%] rounded-sm bg-ink/70" />
        <span className="h-[6px] w-[16%] rounded-sm border border-ink/20" />
        <span className="h-[6px] w-[16%] rounded-sm border border-ink/20" />
        <span className="h-[6px] w-[16%] rounded-sm border border-ink/20" />
      </span>
      <span className="h-[3px] w-[62%] rounded-full bg-ink/25" />
      <span className="h-[3px] w-[54%] rounded-full bg-ink/25" />
      <span className="h-[3px] w-[40%] rounded-full bg-ink/20" />
    </span>
  );
}

/** A short strip over a card grid — the drawer with a home page. */
function TabsDrawerMiniature() {
  return (
    <span className="flex h-full flex-col gap-1 rounded-md border border-ink/10 bg-paper p-1" aria-hidden="true">
      <span className="flex h-[7px] items-center gap-1 border-b border-ink/10 pb-1">
        <span className="h-[6px] w-[6px] rounded-sm border border-ink/20" />
        <span className="h-[6px] w-[24%] rounded-sm bg-ink/70" />
        <span className="h-[6px] w-[20%] rounded-sm border border-ink/20" />
      </span>
      <span className="flex gap-1">
        <span className="h-[16px] w-[24%] rounded border border-ink/15" />
        <span className="h-[16px] w-[24%] rounded border border-ink/15" />
        <span className="h-[16px] w-[24%] rounded border border-ink/15" />
      </span>
    </span>
  );
}

const MOBILE_MINIATURES: Record<MobileRightPanelNav, ComponentType> = {
  classic: ClassicDrawerMiniature,
  tabs: TabsDrawerMiniature,
};

function MobileNavChoice({
  current,
  onPick,
}: {
  current: MobileRightPanelNav;
  onPick: (style: MobileRightPanelNav) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2" role="group" aria-label="Phone right drawer">
      {MOBILE_RIGHT_PANEL_NAVS.map((style) => {
        const copy = MOBILE_COPY[style];
        const isSelected = style === current;
        const Miniature = MOBILE_MINIATURES[style];
        return (
          <button
            key={style}
            type="button"
            onClick={() => onPick(style)}
            aria-pressed={isSelected}
            aria-label={`${copy.label} — ${copy.description}`}
            className={`flex cursor-pointer flex-col gap-2 rounded-xl border p-2.5 text-left transition-colors ${
              isSelected
                ? 'border-ink/40 bg-ink/5'
                : 'border-ink/15 bg-paper hover:border-ink/30 hover:bg-ink/5'
            }`}
          >
            <span className="block h-[54px]">
              <Miniature />
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
  );
}

function PanelNavChoice({
  current,
  onPick,
}: {
  current: PanelNavStyle;
  onPick: (style: PanelNavStyle) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2" role="group" aria-label="Panel navigation">
      {PANEL_NAV_STYLES.map((style) => {
        const copy = PANEL_NAV_COPY[style];
        const isSelected = style === current;
        const Miniature = MINIATURES[style];
        return (
          <button
            key={style}
            type="button"
            onClick={() => onPick(style)}
            aria-pressed={isSelected}
            aria-label={`${copy.label} — ${copy.description}`}
            className={`flex cursor-pointer flex-col gap-2 rounded-xl border p-2.5 text-left transition-colors ${
              isSelected
                ? 'border-ink/40 bg-ink/5'
                : 'border-ink/15 bg-paper hover:border-ink/30 hover:bg-ink/5'
            }`}
          >
            <span className="block h-[54px]">
              <Miniature />
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
  );
}

export function PanelNavSection({ settings, onUpdate }: PanelNavSectionProps) {
  return (
    <section className="space-y-3">
      <div>
        <h4 className="text-sm font-semibold text-ink">Panel navigation</h4>
        <p className="mt-0.5 text-[11px] text-ink/60">
          How each panel column is navigated. Everything is chosen independently: the desktop
          columns do not set each other, and the phone's drawer has its own answer.
        </p>
      </div>

      <div className="space-y-2">
        <div>
          <h5 className="text-[11px] font-semibold text-ink/70">Left column</h5>
          <div className="mt-1.5">
            <PanelNavChoice
              current={resolvePanelNav(settings.leftPanelNav)}
              onPick={(style) => onUpdate({ leftPanelNav: style })}
            />
          </div>
        </div>

        <div>
          <h5 className="text-[11px] font-semibold text-ink/70">Right column</h5>
          <div className="mt-1.5">
            <PanelNavChoice
              current={resolvePanelNav(settings.rightPanelNav)}
              onPick={(style) => onUpdate({ rightPanelNav: style })}
            />
          </div>
        </div>

        <div>
          <h5 className="text-[11px] font-semibold text-ink/70">Phone · right drawer</h5>
          <p className="mt-0.5 text-[11px] text-ink/50">
            A drawer is one screen, so it has no rail to put beside it. This chooses what its
            strip lists instead.
          </p>
          <div className="mt-1.5">
            <MobileNavChoice
              current={resolveMobileRightPanelNav(settings.mobileRightPanelNav)}
              onPick={(style) => onUpdate({ mobileRightPanelNav: style })}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
