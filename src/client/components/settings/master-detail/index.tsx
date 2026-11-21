/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Master-detail shell for the settings categories that are two panes on a
 * desktop (providers, projects, agents, commands, MCP, skills, usage) and for
 * the two that navigate by GROUP inside one category (`chats`,
 * `appearance` — those draw `GroupSidebar` / `GroupDetail`).
 *
 * Both panes stay mounted at every width, so a pane's state — a half-typed
 * form, a scroll position — survives the drill and the back.
 *
 * **The phone draws no chrome of its own.** It used to draw a 35px back bar
 * under the sheet's band, and the pane under that drew a third band with the
 * group's name: measured at 390x844 on Settings → Appearance → Palette, three
 * rows (64 + 35 + 64px) each meant "go back", two of them doing it. The pane now
 * REGISTERS its label and its way out with the sheet's single band
 * (`settings/drill.tsx`), so the phone has one header and the back control is in
 * the same place on every screen.
 */

import type { ComponentChildren } from 'preact';
import { useSettingsDrill } from '@/client/components/settings/drill';
import type { SettingsPane } from '@/client/hooks/settings/master-detail';

interface SettingsMasterDetailProps {
  /** Which pane a phone is showing; desktop shows both. */
  pane: SettingsPane;
  onBack: () => void;
  /** The list pane (a settings sidebar). Owns its own `w-full md:w-64` width. */
  list: ComponentChildren;
  detail: ComponentChildren;
  /** Name of the list, used for the back control's accessible name. */
  listLabel: string;
  /**
   * What the DETAIL pane is called on a phone, for the sheet's band. Defaults
   * to `listLabel`: the pane is then named after the list it came from, which
   * is honest for a CRUD list whose rows are all the same kind of thing. A
   * grouped category passes the active group's label instead.
   */
  detailLabel?: string;
  /** One line under that label, when the pane has one. */
  detailDescription?: string;
  /** Extra classes for the root (e.g. a category-wide `text-xs`). */
  className?: string;
}

export function SettingsMasterDetail({
  pane,
  onBack,
  list,
  detail,
  listLabel,
  detailLabel,
  detailDescription,
  className = '',
}: SettingsMasterDetailProps) {
  // The sheet's band names the drilled pane, and its back control is the pane's
  // own way out. Registered only while the detail is the screen on display, so
  // the list keeps the band it had.
  useSettingsDrill(
    pane === 'detail'
      ? {
          label: detailLabel ?? listLabel,
          description: detailDescription,
          back: onBack,
          backLabel: `Back to ${listLabel}`,
        }
      : null,
  );

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
        {detail}
      </div>
    </div>
  );
}
