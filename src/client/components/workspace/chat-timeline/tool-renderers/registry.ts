/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The panel a tool call renders — read from the SERVER's `render` field.
 *
 * This file used to be the client's own classifier: a name-first lookup over a
 * closed alias table, a separate `type` inference, and (in the ACP producer) a
 * third answer from `kind`. The three could disagree, so one logical shell call
 * drew a Bash card on a harness that sent `name:"Bash"` and a generic
 * Input/Output body on a harness that sent `kind:"other"` plus a title.
 *
 * The classification now happens once, on the server, in
 * `shared/lib/chat/tool/render-key.ts`, and every row arrives carrying
 * `ToolCallData.render`. Nothing here derives a panel from a name any more: a
 * row with no `render` (or `normalized: false`) shows the JSON fallback, which
 * is honest about what the producer could not classify.
 *
 * `xdDevice`/`xdDocPath` stay re-exported because the header and the device
 * panels read the same URL grammar, and a second copy of it would drift.
 */

import type { ToolCallData } from '@/shared/types/chat';
import type { ToolRenderKey } from '@/shared/types/tool-render';
import { soleToolCommand } from '@/shared/lib/chat/tool/tool-commands';

export { xdDevice, xdDocPath, isXdDocRead } from '@/shared/lib/chat/tool/render-key';

/** Every family that has a panel component. `custom` is the JSON fallback. */
export type ToolPanelKind = Exclude<ToolRenderKey, 'custom'>;

/** The panel family for a call, or null when it has none (JSON fallback). */
export function toolPanelKind(tool: ToolCallData): ToolPanelKind | null {
  const render = tool.render;
  if (!render || !render.normalized || render.key === 'custom') return null;
  return render.key;
}

/**
 * The canonical key for a tool call — the renderer family when the server
 * normalized one, else the raw name it reported. Used for the icon and the
 * header's title fallback; it is NOT a classification.
 */
export function resolveToolKey(tool: ToolCallData): string {
  const render = tool.render;
  if (render?.normalized) return render.key;
  return (tool.name || tool.type || '').toLowerCase();
}

/** The tool a call's panel should describe: the wrapped tool command it ran
 *  when that command is the whole call, else its own name. */
export function effectiveToolName(tool: ToolCallData): string {
  const sole = soleToolCommand(tool);
  if (sole) return sole.dispatch.tool;
  return tool.name || tool.type || '';
}

/** True when the card has a specialized panel (the generic body is skipped). */
export function hasToolDetailsPanel(tool: ToolCallData): boolean {
  return toolPanelKind(tool) !== null;
}
