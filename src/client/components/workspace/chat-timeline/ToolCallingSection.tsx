/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { Fragment } from 'preact';
import { useMemo } from 'preact/hooks';
import type { AgentActionData, ToolCallData, ToolType } from '@/shared/types';
import { ToolCallCard } from '@/client/components/workspace/chat-timeline/ToolCallCard';
import { useToolOpenState } from '@/client/hooks/chat/timeline/tool-open';
import { transcriptGutter } from '@/shared/lib/chat/timeline/gutter';

interface ToolCallingSectionProps {
  tools: (ToolCallData | AgentActionData)[];
  defaultExpanded?: boolean;
  /** Phone layout: the section's frame is the timeline gutter itself. */
  isMobile?: boolean;
}

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
  const normalizedTools = useMemo(() => {
    return (tools || []).map((t, i) => normalizeToolData(t, i));
  }, [tools]);

  // Openness is remembered per session, so a reload or a history page-in does
  // not close the call the reader had opened.
  const { openMap, toggle } = useToolOpenState(normalizedTools, defaultExpanded);

  if (!normalizedTools || normalizedTools.length === 0) return null;

  return (
    <div className={`${transcriptGutter(isMobile)} space-y-1.5`} data-tool-section>
      {normalizedTools.map((tool) => {
        const intent = tool.intent?.trim();
        return (
          <Fragment key={tool.id}>
            {intent && (
              <div className="flex items-center gap-2 px-1 pt-0.5">
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
            <ToolCallCard
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
