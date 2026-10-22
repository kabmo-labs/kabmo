/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The navbar entries plugins contribute, resolved once for both surfaces that
 * can draw them.
 *
 * A phone has ONE row, and it is already shared between the wordmark, the
 * session title and four controls that are used mid-conversation. A plugin
 * entry is therefore the first thing that has to give way — and it gives way by
 * moving into the `⋯` menu, not by shrinking, because a readout squeezed under
 * a control is a readout nobody can read.
 *
 * Two facts decide where an entry goes, and both live here rather than at a
 * call site:
 *
 * - **An ACTION entry (`opensPanel`) can fold.** It has one click and no UI of
 *   its own, so a menu row is the same action in words.
 * - **A dropdown or static readout cannot.** A dropdown needs the panel it opens
 *   anchored to a trigger, and a static readout has no action at all; folding
 *   either would be a different control rather than the same one moved.
 *
 * The threshold is a WIDTH, not a device class — the same rule the header's own
 * reload/sign-out fold follows. Measured on a 390px phone with a `CPU 18% /
 * RAM 2.5G` readout (73px): the session title kept 48px of its 74px and was
 * clipped, while at 430px it kept all of it. 430 is therefore where a plugin
 * action may stand in the row.
 */

import { usePanelRegistry, usePanelSlots } from '@/client/hooks/workspace/panel-registry';
import { useViewportAtLeast } from '@/client/hooks/ui/media-query';
import { headerDropdownOf, headerOpensPanelOf, headerTriggerOf } from '@/client/lib/plugins/slots';
import { pluginPanelKey } from '@/shared/lib/workspace/panel-ids';
import type { ComponentType } from 'preact';
import type { HeaderDropdownProps, HeaderTriggerProps } from '@kabmo-labs/kabmo-sdk/app';

/**
 * The narrowest phone row that still holds a plugin action beside the session
 * title. See this module's own doc for the measurement behind it.
 */
export const MOBILE_HEADER_ACTION_PX = 430;

/**
 * The widest a plugin entry may be on a phone.
 *
 * A plugin owns its trigger's markup, so without a ceiling one readout could
 * take the whole row. The cap is the width a two-column CPU/RAM readout needs
 * plus room, and anything past it is the plugin's own problem to shorten — the
 * alternative is the host clipping a control the user cannot then identify.
 */
export const MOBILE_HEADER_ENTRY_MAX_PX = 96;

export interface HeaderEntry {
  pluginId: string;
  title: string;
  /** What the navbar entry reads. */
  Trigger: ComponentType<HeaderTriggerProps>;
  /** What opening it shows, when the plugin declared one. */
  Dropdown?: ComponentType<HeaderDropdownProps>;
  /** The panel instance key the trigger opens, when it declared `opensPanel`. */
  opensPanelKey?: string;
}

export interface HeaderEntries {
  /** Entries that may stand in the row. */
  inline: HeaderEntry[];
  /** ACTION entries the row could not hold, for the `⋯` menu. */
  folded: HeaderEntry[];
}

/** Resolve what the row draws, given the layout and the width it has. */
export function useHeaderEntries(layout: 'desktop' | 'mobile'): HeaderEntries {
  const { panels } = usePanelRegistry();
  const { slots } = usePanelSlots();
  // Hooks are unconditional: a desktop never asks the media query's answer, but
  // calling it only on one branch would change the hook order per layout.
  const wideEnough = useViewportAtLeast(MOBILE_HEADER_ACTION_PX);

  const all: HeaderEntry[] = [];
  for (const panel of panels) {
    const entry = slots.get(panel.pluginId);
    const Trigger = entry ? headerTriggerOf(entry) : undefined;
    // A plugin whose bundle has not loaded yet has no component; it appears
    // once the import settles rather than as an empty entry now.
    if (!Trigger) continue;
    const Dropdown = entry ? headerDropdownOf(entry) : undefined;
    const opensSlot = entry ? headerOpensPanelOf(entry) : undefined;
    all.push({
      pluginId: panel.pluginId,
      title: entry?.titles.headerPanel ?? panel.name,
      Trigger,
      ...(Dropdown ? { Dropdown } : {}),
      // The panel is named by its INSTANCE key, so the click lands on the
      // plugin's own `rightPanel` or `panel` registration — the same key the
      // activity bar, the width map and the dock's placement list use. The
      // plugin never names a column: where it is drawn is the user's choice.
      ...(opensSlot ? { opensPanelKey: pluginPanelKey(panel.pluginId, opensSlot) } : {}),
    });
  }

  if (layout === 'desktop' || wideEnough) return { inline: all, folded: [] };
  // A narrow phone: the row keeps only what cannot be expressed as a menu row.
  return {
    inline: all.filter((entry) => !entry.opensPanelKey),
    folded: all.filter((entry) => entry.opensPanelKey),
  };
}
