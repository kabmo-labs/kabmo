/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `trace` style — a vertical rail per section, one node per call.
 *
 * The section draws the rail; a row draws its own node, its line, and — when
 * opened — its body in place under that node. Modelled on the step cards Cursor
 * and Devin use, and on shadcn's `Trace` primitives.
 *
 * The rail is `aria-hidden`: it is a drawing of order, and the order is already
 * the DOM order a screen reader walks. The node's tone is the status, so a
 * failed step is visible without opening anything.
 */

import { useCallback, useState } from 'preact/hooks';
import { memo } from 'preact/compat';
import { ToolBody } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/ToolBody';
import { ToolFactChips } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/ToolFactChips';
import { toolStatusGlyph, STATUS_TONE_CLASS } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/status-glyph';
import { useToolView } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/tool-view';
import { toolToggleLabel } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/toggle-label';
import type { ToolRowProps } from '@/client/components/workspace/chat-timeline/tool-renderers/styles/props';

export const TraceRow = memo(function TraceRow({ tool, isOpen, onToggle, defaultExpanded = false }: ToolRowProps) {
  const view = useToolView(tool);
  const [internalOpen, setInternalOpen] = useState(defaultExpanded);
  const isExpanded = view.alwaysExpanded || (isOpen ?? internalOpen);
  const status = toolStatusGlyph(tool);

  const handleToggle = useCallback(() => {
    if (onToggle) onToggle(tool.id);
    else setInternalOpen((prev) => !prev);
  }, [onToggle, tool.id]);

  return (
    <div className="relative pl-4" data-tool-row="trace">
      {/* The node, drawn ON the section's rail. `-left-px` centres it on the
          1px line the section owns. */}
      <span
        aria-hidden="true"
        className={`absolute left-0 top-[9px] flex h-2 w-2 items-center justify-center rounded-full ${
          status.tone === 'error' ? 'bg-error' : status.tone === 'ok' ? 'bg-ink/45' : 'bg-ink/20'
        }`}
      />

      <button
        type="button"
        onClick={handleToggle}
        disabled={!view.hasBody || view.alwaysExpanded}
        aria-expanded={isExpanded}
        aria-label={view.hasBody && !view.alwaysExpanded ? toolToggleLabel(view.header.title, view.subtitle, isExpanded) : undefined}
        className={`flex w-full flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-md px-1.5 py-1 text-left transition-colors ${
          view.hasBody && !view.alwaysExpanded ? 'cursor-pointer hover:bg-ink/[0.03]' : 'cursor-default'
        } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20`}
      >
        <span className={`shrink-0 self-center ${STATUS_TONE_CLASS[status.tone]}`} aria-hidden="true">
          {status.glyph}
        </span>
        <span className="sr-only">{status.word}</span>
        <span className="shrink-0 text-[12px] font-semibold tracking-tight text-ink">{view.header.title}</span>
        {/* Subject + facts in ONE clipping row, the way the card's meta line
            draws it: without the clip a long chip pair widened the section past
            the phone viewport (measured at 390: 455 scrollWidth against 362). */}
        <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-ink/45">{view.subtitle}</span>
          {view.summary && view.summary.facts.length > 0 && (
            <span className="shrink-0">
              <ToolFactChips facts={view.summary.facts} max={2} />
            </span>
          )}
        </span>
      </button>

      {isExpanded && view.hasBody && (
        <div className="mb-1 ml-[3.5px] overflow-hidden border-l border-ink/10 py-2 pl-3 space-y-3 code-surface">
          <ToolBody tool={tool} view={view} />
        </div>
      )}
    </div>
  );
});
