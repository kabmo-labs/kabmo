/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `compact` style — one status line per call, the body inset on demand.
 *
 * Modelled on the status line Claude's transcript and shadcn's `Trace` element
 * use: no frame, no card, one row that states the outcome and the facts. The
 * outcome is the glyph WITH its word for a screen reader (`status-glyph.tsx`),
 * because a one-line style has no room for a badge but the collapsed state must
 * still say whether the call failed.
 *
 * The facts stay whole and the subtitle truncates — the same rule the card
 * learned: a half-ellipsized fact reads as a wrong fact.
 */

import { useCallback, useState } from 'preact/hooks';
import { memo } from 'preact/compat';
import { ChevronDown } from 'lucide-preact';
import { ToolBody } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/ToolBody';
import { ToolFactChips } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/ToolFactChips';
import { toolStatusGlyph, STATUS_TONE_CLASS } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/status-glyph';
import { useToolView } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/tool-view';
import { toolToggleLabel } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/toggle-label';
import type { ToolRowProps } from '@/client/components/workspace/chat-timeline/tool-renderers/styles/props';

export const CompactRow = memo(function CompactRow({ tool, isOpen, onToggle, defaultExpanded = false }: ToolRowProps) {
  const view = useToolView(tool);
  const [internalOpen, setInternalOpen] = useState(defaultExpanded);
  const isExpanded = view.alwaysExpanded || (isOpen ?? internalOpen);
  const status = toolStatusGlyph(tool);

  const handleToggle = useCallback(() => {
    if (onToggle) onToggle(tool.id);
    else setInternalOpen((prev) => !prev);
  }, [onToggle, tool.id]);

  return (
    <div className="group" data-tool-row="compact">
      <button
        type="button"
        onClick={handleToggle}
        disabled={!view.hasBody || view.alwaysExpanded}
        aria-expanded={isExpanded}
        aria-label={view.hasBody && !view.alwaysExpanded ? toolToggleLabel(view.header.title, view.subtitle, isExpanded) : undefined}
        className={`flex w-full flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md px-1.5 py-1 text-left transition-colors ${
          view.hasBody && !view.alwaysExpanded ? 'cursor-pointer hover:bg-ink/[0.03]' : 'cursor-default'
        } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20`}
      >
        <span className={`shrink-0 ${STATUS_TONE_CLASS[status.tone]}`} aria-hidden="true">
          {status.glyph}
        </span>
        <span className="sr-only">{status.word}</span>
        <span className="shrink-0 text-ink/45" aria-hidden="true">
          {view.icon}
        </span>
        <span className="shrink-0 truncate text-[12px] font-semibold tracking-tight text-ink">
          {view.header.title}
        </span>
        {/* The subject and the facts share ONE clipping row, the way the card's
            meta line does. Without the clip a long `+43 −16` chip pair widened
            the section past the phone viewport: measured at 390, the section's
            scrollWidth ran to 439 against a 362 client width. */}
        <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-ink/45">{view.subtitle}</span>
          {view.summary && view.summary.facts.length > 0 && (
            <span className="shrink-0">
              <ToolFactChips facts={view.summary.facts} max={2} />
            </span>
          )}
        </span>
        {view.hasBody && !view.alwaysExpanded && (
          <ChevronDown
            size={13}
            className={`shrink-0 text-ink/30 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
          />
        )}
      </button>

      {isExpanded && view.hasBody && (
        <div className="ml-5 mt-0.5 overflow-hidden border-l border-dashed border-ink/15 py-2 pl-3 space-y-3 code-surface">
          <ToolBody tool={tool} view={view} />
        </div>
      )}
    </div>
  );
});
