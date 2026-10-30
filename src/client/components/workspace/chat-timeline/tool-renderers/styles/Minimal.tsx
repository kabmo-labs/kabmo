/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `minimal` style — a faint line per call, read as part of the answer.
 *
 * This is the quietest form, and the one where being honest matters most: a
 * line with no frame can look decorative, so it still carries the outcome
 * glyph, the subject and the facts, and a failed call is the ONLY row that
 * takes a tone. Everything else stays in the ink tones the palette reserves for
 * text, which is what keeps the answer readable and the tool row subordinate to
 * it.
 */

import { useCallback, useState } from 'preact/hooks';
import { memo } from 'preact/compat';
import { ToolBody } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/ToolBody';
import { toolStatusGlyph, STATUS_TONE_CLASS } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/status-glyph';
import { useToolView } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/tool-view';
import { toolToggleLabel } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/toggle-label';
import type { ToolRowProps } from '@/client/components/workspace/chat-timeline/tool-renderers/styles/props';

export const MinimalRow = memo(function MinimalRow({ tool, isOpen, onToggle, defaultExpanded = false }: ToolRowProps) {
  const view = useToolView(tool);
  const [internalOpen, setInternalOpen] = useState(defaultExpanded);
  const isExpanded = view.alwaysExpanded || (isOpen ?? internalOpen);
  const status = toolStatusGlyph(tool);
  // Only an outcome the reader must not miss takes a tone; a success stays in
  // ink so a run of ten calls does not read as ten warnings.
  const toneClass = status.tone === 'error' || status.tone === 'warn' ? STATUS_TONE_CLASS[status.tone] : 'text-ink/35';

  const handleToggle = useCallback(() => {
    if (onToggle) onToggle(tool.id);
    else setInternalOpen((prev) => !prev);
  }, [onToggle, tool.id]);

  const factsLine = view.summary?.line ? ` (${view.summary.line})` : '';

  return (
    <div className="px-1" data-tool-row="minimal">
      <button
        type="button"
        onClick={handleToggle}
        disabled={!view.hasBody || view.alwaysExpanded}
        aria-expanded={isExpanded}
        aria-label={view.hasBody && !view.alwaysExpanded ? toolToggleLabel(view.header.title, view.subtitle, isExpanded) : undefined}
        className={`flex w-full items-baseline gap-1.5 rounded py-0.5 text-left text-[11.5px] transition-colors ${
          view.hasBody && !view.alwaysExpanded ? 'cursor-pointer hover:bg-ink/[0.03]' : 'cursor-default'
        } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20`}
      >
        <span className={`shrink-0 self-center ${toneClass}`} aria-hidden="true">
          {status.glyph}
        </span>
        <span className="sr-only">{status.word}</span>
        <span className="shrink-0 font-medium text-ink/70">{view.header.title}</span>
        {(view.subtitle || factsLine) && <span className="text-ink/25">—</span>}
        <span className="min-w-0 truncate font-mono text-ink/45">
          {view.subtitle}
          {factsLine}
        </span>
      </button>

      {isExpanded && view.hasBody && (
        <div className="my-1.5 overflow-hidden rounded-md border border-dashed border-ink/15 px-3 py-2.5 space-y-3 code-surface">
          <ToolBody tool={tool} view={view} />
        </div>
      )}
    </div>
  );
});
