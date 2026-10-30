/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A block of tool calls in the transcript, drawn in the style the user chose.
 *
 * The section owns three things and delegates the rest:
 *
 * 1. **Normalization** — the MOCK/sample path carries `AgentActionData`, which
 *    is mapped onto `ToolCallData` so every style reads one shape.
 * 2. **Openness** — persisted per session by `useToolOpenState`, so a reload or
 *    a history page-in does not close the call the reader opened.
 * 3. **The intent heading** — one line above a call, naming what the call was
 *    for. It is drawn by the section, not by a style, so the four styles cannot
 *    disagree about it.
 *
 * The STYLE decides the frame: `card` draws `CardRow`, `compact` a status line,
 * `trace` a rail node, `minimal` a faint line. Every style receives the same
 * tool and the same openness, and each renders the shared `ToolBody`.
 */

import { Fragment } from 'preact';
import { useMemo } from 'preact/hooks';
import type { FunctionComponent } from 'preact/compat';
import type { AgentActionData, ToolCallData, ToolType } from '@/shared/types';
import { useToolOpenState } from '@/client/hooks/chat/timeline/tool-open';
import { useToolRenderMode } from '@/client/hooks/chat/timeline/tool-render-mode';
import { transcriptGutter } from '@/shared/lib/chat/timeline/gutter';
import type { ToolRenderMode } from '@/shared/lib/chat/timeline/tool-render-mode';
import { CardRow } from '@/client/components/workspace/chat-timeline/tool-renderers/styles/Card';
import { CompactRow } from '@/client/components/workspace/chat-timeline/tool-renderers/styles/Compact';
import { TraceRow } from '@/client/components/workspace/chat-timeline/tool-renderers/styles/Trace';
import { MinimalRow } from '@/client/components/workspace/chat-timeline/tool-renderers/styles/Minimal';
import type { ToolRowProps } from '@/client/components/workspace/chat-timeline/tool-renderers/styles/props';

interface ToolCallingSectionProps {
  tools: (ToolCallData | AgentActionData)[];
  defaultExpanded?: boolean;
  /** Phone layout: the section's frame is the timeline gutter itself. */
  isMobile?: boolean;
}

/** One renderer per mode — a total map, so a new mode is a build error here. */
const ROW_BY_MODE: Record<ToolRenderMode, FunctionComponent<ToolRowProps>> = {
  card: CardRow,
  compact: CompactRow,
  trace: TraceRow,
  minimal: MinimalRow,
};

function normalizeToolData(action: ToolCallData | AgentActionData, index: number): ToolCallData {
  if ('id' in action && action.id) {
    return action as ToolCallData;
  }

  const rawTitle = action.title || '';
  const lowerTitle = rawTitle.toLowerCase();

  let type: ToolCallData['type'] = 'terminal';
  if (lowerTitle.includes('shell') || lowerTitle.includes('command') || lowerTitle.includes('bun') || lowerTitle.includes('git')) {
    type = 'bash';
  } else if (lowerTitle.includes('edit') || lowerTitle.includes('write')) {
    type = 'edit_file';
  } else if (lowerTitle.includes('read') || lowerTitle.includes('view') || lowerTitle.includes('cat') || lowerTitle.includes('inspect')) {
    type = 'read_file';
  } else if (lowerTitle.includes('search') || lowerTitle.includes('find') || lowerTitle.includes('grep')) {
    type = 'search_fs';
  }

  const cleanSlug = rawTitle.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase() || 'tool';
  const finalType: ToolType = ('type' in action && action.type) ? action.type : type;

  return {
    id: `stable-tool-${index}-${cleanSlug}`,
    type: finalType,
    title: action.title,
    duration: action.time,
    time: action.time,
    detail: action.detail,
    target: ('target' in action && action.target) ? action.target : (finalType === 'read_file' || finalType === 'edit_file' || finalType === 'create_file' ? action.detail : undefined),
    command: action.command || (finalType === 'bash' ? action.detail : undefined),
    output: action.output,
    status: action.status || 'success',
    icon: action.icon,
    diff: 'diff' in action ? action.diff : undefined,
    input: 'input' in action ? action.input : undefined
  };
}

export function ToolCallingSection({ tools, defaultExpanded = false, isMobile = false }: ToolCallingSectionProps) {
  const mode = useToolRenderMode();
  const Row = ROW_BY_MODE[mode];

  const normalizedTools = useMemo(() => {
    return (tools || []).map((t, i) => normalizeToolData(t, i));
  }, [tools]);

  // Openness is remembered per session, so a reload or a history page-in does
  // not close the call the reader had opened.
  const { openMap, toggle } = useToolOpenState(normalizedTools, defaultExpanded);

  if (!normalizedTools || normalizedTools.length === 0) return null;

  return (
    <div
      className={`${transcriptGutter(isMobile)} ${mode === 'trace' ? 'relative' : 'space-y-1.5'}`}
      data-tool-section
      data-tool-style={mode}
    >
      {/* The rail itself is drawn ONCE per turn by `TurnRail` (see
          `MessageItem`): a segment per section broke wherever prose sat between
          two blocks, which is exactly what a trace may not do. A row still
          places its own node. */}
      {normalizedTools.map((tool) => {
        const intent = tool.intent?.trim();
        return (
          <Fragment key={tool.id}>
            {intent && (
              <div className={`flex items-center gap-2 px-1 pt-0.5 ${mode === 'trace' ? 'pl-4' : ''}`}>
                {/* Label sizes to its text; the rule takes everything left over,
                    so the line runs to the panel edge the way `ThinkingSection`
                    draws it. The label is NOT `flex-1` — two `flex-1` items split
                    the row 50/50 regardless of content, which parks a short
                    heading's rule in the middle of the row. `min-w-6` on the rule
                    keeps it visible when a sentence-length intent has to shrink
                    (a plain `flex-1` basis of 0 would collapse it to nothing). */}
                <span
                  className="min-w-0 truncate text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink/35"
                  title={intent}
                >
                  {intent}
                </span>
                <span className="h-px min-w-6 flex-1 bg-ink/8" />
              </div>
            )}
            <Row
              tool={tool}
              isOpen={Boolean(openMap[tool.id])}
              onToggle={toggle}
            />
          </Fragment>
        );
      })}
    </div>
  );
}
