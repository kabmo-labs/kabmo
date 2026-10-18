/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Whether a tool call's body is open, remembered per session.
 *
 * The state used to live in a `useState` inside each section, so it was lost on
 * every remount — a reload, a session switch, or the timeline paging history in
 * and out — and a reader who had opened the one call they cared about had to
 * find and open it again. It is a preference about the conversation, which is
 * exactly what `session_ui_state` holds.
 *
 * Only the ids the reader TOUCHED are stored. A card's default (an error opens
 * itself, a skipped call does not, everything else starts closed) is derived at
 * render time, so a fresh run does not write a row per tool call into the
 * session blob.
 */

import { useCallback, useMemo } from 'preact/hooks';
import { useSessionState } from '@/client/hooks/workspace/session-state';
import { isSkippedTool } from '@/shared/lib/chat/tool-status';
import type { ToolCallData } from '@/shared/types/chat';

/** Session slot holding `{ [toolId]: open }` for the calls the reader toggled. */
export const TOOL_OPEN_STATE_KEY = 'chat.toolOpen';

/**
 * Default openness for a call nobody has toggled: an error is worth showing
 * without a click, a skipped call is not, and everything else starts closed.
 * `autoOpenFirst` is the section-level default for a follow-up tool block.
 *
 * A `wait` is ALWAYS open, in both states, and the second half is the one that
 * was learned the hard way. While it blocks, its whole content is a clock and a
 * progress bar — a collapsed card hides the only thing the reader is watching.
 * Gating the default on `status === 'running'` made the card open for the run
 * and then CLOSE ITSELF the instant the call returned, which is precisely the
 * moment the reader wants the result: measured in a browser spec, the settled
 * panel (bar, job rows, outcome) vanished under the reader's cursor. It also
 * differs from its siblings for a real reason — a `bash` body is a long log and
 * belongs folded, while a wait's is three short rows.
 *
 * A stored choice still wins, so closing it stays closed.
 */
function defaultOpen(tool: ToolCallData, autoOpenFirst: boolean, index: number): boolean {
  if (isSkippedTool(tool)) return false;
  if (tool.status === 'error') return true;
  if ((tool.name || tool.type) === 'wait') return true;
  return autoOpenFirst && index === 0;
}

export interface ToolOpenState {
  /** Resolved openness per tool id — stored choice first, default second. */
  openMap: Record<string, boolean>;
  /** Flip one call, persisting the reader's choice. */
  toggle: (toolId: string) => void;
}

export function useToolOpenState(tools: ToolCallData[], autoOpenFirst: boolean): ToolOpenState {
  const [stored, setStored] = useSessionState<Record<string, boolean>>(TOOL_OPEN_STATE_KEY, {});

  const openMap = useMemo(() => {
    const map: Record<string, boolean> = {};
    tools.forEach((tool, index) => {
      const explicit = stored[tool.id];
      map[tool.id] = explicit === undefined ? defaultOpen(tool, autoOpenFirst, index) : explicit;
    });
    return map;
  }, [tools, stored, autoOpenFirst]);

  const toggle = useCallback(
    (toolId: string) => {
      setStored((prev) => {
        const tool = tools.find((entry) => entry.id === toolId);
        // The first toggle of an untouched call has to flip its DERIVED default,
        // not an absent key — otherwise an auto-opened error would need two
        // clicks to close.
        const current = prev[toolId] ?? (tool ? defaultOpen(tool, autoOpenFirst, tools.indexOf(tool)) : false);
        return { ...prev, [toolId]: !current };
      });
    },
    [setStored, tools, autoOpenFirst],
  );

  return { openMap, toggle };
}
