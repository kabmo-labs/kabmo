/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The `timelineRenderer` list slot's resolver.
 *
 * The host keeps its own renderer for a tool it knows (`toolPanelKind`), so a
 * plugin renderer is consulted only for a tool the host has NO panel for — that
 * is what the slot's contract says (`TimelineRendererRegistration.tool` is
 * matched exactly, "for a tool it does not [know]"), and it is what keeps a
 * plugin from shadowing `bash` or `read`.
 *
 * Resolution is a lookup over the store's merged rows, which is already sorted
 * by `order`; the first exact match wins. It is deliberately a HOOK, not a
 * module-level table, because a renderer registered after this card mounted
 * must reach it without a reload.
 */

import type { TimelineRendererRegistration } from '@ompchamber/plugin-sdk';
import type { ListSlotEntry } from '@/client/lib/plugins/list-slots';
import { useListSlotRows } from '@/client/hooks/workspace/list-slots';

/**
 * The plugin renderer for `tool`, with the plugin that registered it, or null
 * when the host's own panel should run.
 *
 * The plugin id rides along because the host must wrap the render in that
 * plugin's surface: a plugin's stylesheet is scoped to
 * `[data-plugin-surface="<id>"]`, so a renderer drawn outside its own surface
 * would have no CSS at all.
 */
export function usePluginTimelineRenderer(tool: string): ListSlotEntry<TimelineRendererRegistration> | null {
  const rows = useListSlotRows<TimelineRendererRegistration>('timelineRenderer');
  for (const entry of rows) {
    if (entry.registration.tool === tool) return entry;
  }
  return null;
}
