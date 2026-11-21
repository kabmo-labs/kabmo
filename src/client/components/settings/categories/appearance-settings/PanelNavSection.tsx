/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Settings → Appearance → Shell → Panel navigation.
 *
 * FOUR controls: one per desktop column and one per phone drawer. They are all
 * independent, and that is the point rather than an oversight — each surface
 * answers a different question:
 *
 * - the desktop left column is the session list plus whatever the user placed
 *   there, and a rail is a 44px strip beside it;
 * - the desktop right column is a working set opened and closed all day;
 * - a phone drawer is a SCREEN, so it has no rail to put beside it at all. Its
 *   choice is what its chip strip LISTS: every view, or the working set over a
 *   home page.
 *
 * The desktop and the phone are separate axes for a measured reason: the same
 * person may want the browser-style strip on a desktop column and the plain
 * catalog on a drawer, and one shared value would force one surface's best shape
 * on the other.
 *
 * The drawing in each card is a MINIATURE of the real surface (`nav-miniatures`),
 * because "rail" and "tabs" are words the user has to translate into a picture
 * they have seen. Each group is a pair of `aria-pressed` buttons rather than
 * radios in a form: there is no submit, the choice applies on click, and
 * `onUpdate` persists it.
 */

import type { SettingsState } from '@/shared/types';
import { resolveMobilePanelNav, resolvePanelNav } from '@/shared/lib/workspace/panel-nav';
import { MobileNavChoice, PanelNavChoice } from '@/client/components/settings/categories/appearance-settings/nav-choice';

interface PanelNavSectionProps {
  settings: SettingsState;
  onUpdate: (updater: Partial<SettingsState> | ((previous: SettingsState) => SettingsState)) => void;
}

export function PanelNavSection({ settings, onUpdate }: PanelNavSectionProps) {
  return (
    <section className="space-y-3">
      <div>
        <h4 className="text-sm font-semibold text-ink">Panel navigation</h4>
        <p className="mt-0.5 text-[11px] text-ink/60">
          How each panel surface is navigated. Everything is chosen independently: the desktop
          columns do not set each other, and each phone drawer has its own answer.
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
          <h5 className="text-[11px] font-semibold text-ink/70">Phone · left drawer</h5>
          <p className="mt-0.5 text-[11px] text-ink/50">
            The drawer is one screen, so it has no rail to put beside it. This chooses what its
            strip lists instead. Under Tabs the session list stays the first, pinned chip.
          </p>
          <div className="mt-1.5">
            <MobileNavChoice
              side="left"
              current={resolveMobilePanelNav(settings.mobileLeftPanelNav)}
              onPick={(style) => onUpdate({ mobileLeftPanelNav: style })}
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
              side="right"
              current={resolveMobilePanelNav(settings.mobileRightPanelNav)}
              onPick={(style) => onUpdate({ mobileRightPanelNav: style })}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
