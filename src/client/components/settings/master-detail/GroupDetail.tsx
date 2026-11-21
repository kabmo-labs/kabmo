/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The detail pane of a grouped settings category: the group's sections in one
 * scroller, under a header band on a DESKTOP only.
 *
 * The band is outside the scroller on a desktop on purpose — a reader five cards
 * into the Editor group can still see which group they are in without scrolling
 * back. A PHONE draws no band here: the sheet has one, and this pane's group name
 * is what it names (`settings/drill.tsx`). Drawing it here as well produced
 * three stacked bars on one screen (measured 64 + 35 + 64px on
 * Settings → Appearance → Palette), two of which were a back control.
 *
 * The sections are children, so each category keeps owning WHICH components a
 * group draws while the frame is stated once.
 */

import type { ComponentChildren } from 'preact';
import type { SettingsGroup } from '@/client/components/settings/master-detail/GroupSidebar';
import { SETTINGS_BAND, SETTINGS_BAND_HEIGHT } from '@/client/components/settings/pane-header';

interface GroupDetailProps {
  group: Pick<SettingsGroup, 'label'> & { description: string };
  children: ComponentChildren;
}

export function GroupDetail({ group, children }: GroupDetailProps) {
  return (
    <div className="flex-1 h-full overflow-hidden flex flex-col text-xs text-ink">
      <div
        className={`${SETTINGS_BAND} hidden md:flex items-start flex-col justify-center px-3.5`}
        style={{ height: SETTINGS_BAND_HEIGHT }}
      >
        <span className="text-xs font-semibold text-ink/75">{group.label}</span>
        <p className="w-full text-[11px] text-ink/60 leading-snug mt-0.5 truncate">{group.description}</p>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-overlay-container p-3.5 space-y-7 pb-6">
        {children}
      </div>
    </div>
  );
}
