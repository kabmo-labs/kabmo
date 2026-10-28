/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import type { ComponentChildren } from 'preact';
import { ChevronLeft } from 'lucide-preact';
import type { SettingsPane } from '@/client/hooks/settings/master-detail';

interface SettingsMasterDetailProps {
  /** Which pane a phone is showing; desktop shows both. */
  pane: SettingsPane;
  onBack: () => void;
  /** The list pane (a settings sidebar). Owns its own `w-full md:w-64` width. */
  list: ComponentChildren;
  detail: ComponentChildren;
  /** Name of the list, shown on the phone's back bar. */
  listLabel: string;
  /** Extra classes for the root (e.g. a category-wide `text-xs`). */
  className?: string;
}

/**
 * Master-detail shell for the settings categories that are two panes on a
 * desktop (providers, projects, agents, commands, MCP, skills, usage).
 *
 * Both panes stay mounted at every width, so a pane's state — a half-typed
 * form, a scroll position — survives the drill and the back. Only the phone
 * needs the extra bar: on `md` the two panes sit side by side exactly as
 * before and the bar is not rendered at all.
 */
export function SettingsMasterDetail({
  pane,
  onBack,
  list,
  detail,
  listLabel,
  className = '',
}: SettingsMasterDetailProps) {
  return (
    <div className={`flex-1 flex flex-col md:flex-row h-full w-full min-w-0 overflow-hidden bg-paper text-ink ${className}`}>
      {/* `min-w-0` on both panes: a flex item's default `min-width: auto` is its
          content's min-content width, so the detail pane refused to shrink below
          its widest row (a provider's name + action strip) and ran 207px past the
          modal at a 768-900px window — clipped, since the modal is
          `overflow-hidden`. The list pane carries it for the same reason. */}
      <div className={`${pane === 'list' ? 'flex' : 'hidden'} md:flex flex-1 md:flex-none md:w-auto min-h-0 min-w-0 flex-col`}>
        {list}
      </div>

      <div className={`${pane === 'detail' ? 'flex' : 'hidden'} md:flex flex-1 min-h-0 min-w-0 flex-col`}>
        <div className="md:hidden flex items-center px-2 py-1 border-b border-ink/10 bg-canvas flex-shrink-0">
          <button
            type="button"
            onClick={onBack}
            aria-label={`Back to ${listLabel}`}
            className="flex items-center gap-1 -ml-0.5 pl-0.5 pr-2 py-1 rounded-lg text-ink hover:bg-ink/5 active:bg-ink/10 transition-colors cursor-pointer"
          >
            <ChevronLeft size={18} />
            <span className="text-xs font-semibold truncate">{listLabel}</span>
          </button>
        </div>

        {detail}
      </div>
    </div>
  );
}
