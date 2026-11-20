/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The detail pane of a grouped settings category: the active group's name and
 * description in a fixed header, then the group's sections in one scroller.
 *
 * The header is outside the scroller on purpose — a reader five cards into the
 * Editor group can still see which group they are in without scrolling back.
 * The sections are children, so each category keeps owning WHICH components a
 * group draws (its `Record<SectionId, …>`) while the frame is stated once.
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
      <div className={`${SETTINGS_BAND} flex-col justify-center px-3.5`} style={{ height: SETTINGS_BAND_HEIGHT }}>
        <span className="text-xs font-semibold text-ink/75">{group.label}</span>
        <p className="text-[11px] text-ink/60 leading-snug mt-0.5 truncate">{group.description}</p>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-overlay-container p-3.5 space-y-7 pb-6">
        {children}
      </div>
    </div>
  );
}
