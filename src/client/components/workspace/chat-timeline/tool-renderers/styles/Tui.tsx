/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `tui` style — omp's terminal transcript, drawn as TEXT in the browser.
 *
 * omp's terminal writes a call as a status line, not as a box: the glyph in the
 * state's tone, the tool name in the title colour, `: subject` in the muted
 * colour, the outcome in brackets, then the quiet facts joined by ` · `
 * (`renderStatusLine` in `@oh-my-pi/pi-tui`). Framed boxes are reserved for
 * tools whose OUTPUT is a bordered pane (bash, eval); the tool line itself is
 * prose. This style follows that split — no border, no fill, no card — and the
 * colour carries the structure instead:
 *
 *  - the outcome glyph and its `[word]` take the call's state colour;
 *  - the tool name is the accent (`--theme-info`), the subject is the meta hue
 *    (`--theme-meta`), so the two halves of the head are never confused;
 *  - facts keep their own tones (`+4` green, `−1` red, a warning amber) and a
 *    neutral fact stays dim.
 *
 * The expand contract is the shared one — `toolToggleLabel`'s wording, the same
 * `.code-surface` body, `▸` / `▾` as the affordance — so expand/collapse, the
 * intent heading above the row and every e2e selector (`[aria-label^="Expand "]`,
 * `/^Expand Bash/`) behave exactly as they do for the card.
 *
 * Nothing here derives text: `useToolView` owns what a call SAYS
 * (`shared/tool-view.ts`), `ToolBody` owns what it SHOWS when opened, so this
 * file is colour and line shape only.
 */

import { useCallback, useState } from 'preact/hooks';
import { memo } from 'preact/compat';
import type { ToolCallData } from '@/shared/types';
import { ToolBody } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/ToolBody';
import {
  toolStatusGlyph,
  type ToolStatusTone,
} from '@/client/components/workspace/chat-timeline/tool-renderers/shared/status-glyph';
import { useToolView } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/tool-view';
import { toolToggleLabel } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/toggle-label';
import type { ToolRowProps } from '@/client/components/workspace/chat-timeline/tool-renderers/styles/props';
import type { ToolFact } from '@/shared/lib/chat/tool/summary';

/**
 * A run state, which is NOT the same axis as `ToolStatusTone`: omp paints a
 * running call with its pending accent, where a one-line style just spins the
 * glyph. `run` exists only here.
 */
type TuiRunState = 'run' | 'ok' | 'error' | 'warn' | 'muted';

/**
 * The colour of the outcome — the glyph, the bracketed word — per state. Only
 * the outcome is allowed to be loud: a success stays green because that is what
 * a terminal prints, and a run is the accent.
 */
const STATE_COLOR: Record<TuiRunState, string> = {
  run: 'text-info',
  ok: 'text-success',
  error: 'text-error',
  warn: 'text-warning',
  muted: 'text-ink/35',
};

function runState(tool: ToolCallData, status: ToolStatusTone): TuiRunState {
  if (tool.status === 'running') return 'run';
  if (status === 'error') return 'error';
  if (status === 'warn') return 'warn';
  if (status === 'muted') return 'muted';
  return 'ok';
}

/** One fact as terminal text: `+4` green and `−1` red inside one statement. */
function FactText({ fact }: { fact: ToolFact }) {
  if (fact.parts && fact.parts.length > 0) {
    return (
      <>
        {fact.parts.map((part, index) => (
          <span key={`${part.label}-${index}`} className={part.tone === 'ok' ? 'text-success' : 'text-error'}>
            {part.label}
          </span>
        ))}
      </>
    );
  }
  const toneClass =
    fact.tone === 'ok'
      ? 'text-success'
      : fact.tone === 'error'
        ? 'text-error'
        : fact.tone === 'warn'
          ? 'text-warning'
          : 'text-ink/45';
  return <span className={toneClass}>{fact.label}</span>;
}

/** How many facts the one-line head states before the rest are dropped. */
const HEAD_FACT_LIMIT = 2;

/** The facts of one call, ` · `-joined in `toolSummary`'s order. */
function Facts({ facts, max = 4 }: { facts: ToolFact[]; max?: number }) {
  return (
    <>
      {facts.slice(0, max).map((fact, index) => (
        <span key={`${fact.kind}-${index}`}>
          {index > 0 && <span className="text-ink/25"> · </span>}
          <span title={fact.title ?? fact.label}>
            <FactText fact={fact} />
          </span>
        </span>
      ))}
    </>
  );
}

export const TuiRow = memo(function TuiRow({ tool, isOpen, onToggle, defaultExpanded = false }: ToolRowProps) {
  const view = useToolView(tool);
  const [internalOpen, setInternalOpen] = useState(defaultExpanded);
  const isExpanded = view.alwaysExpanded || (isOpen ?? internalOpen);
  const status = toolStatusGlyph(tool);
  const tone = STATE_COLOR[runState(tool, status.tone)];
  const facts = view.summary?.facts ?? [];
  const canToggle = view.hasBody && !view.alwaysExpanded;

  const handleToggle = useCallback(() => {
    if (onToggle) onToggle(tool.id);
    else setInternalOpen((prev) => !prev);
  }, [onToggle, tool.id]);

  return (
    <div data-tool-row="tui" className="font-mono">
      {/* The status line itself: glyph, name, subject, outcome, facts. Text
          only — the colours separate the three claims (what ran, on what, how
          it ended), which is what the terminal does with SGR and what a box
          would otherwise have to do with borders. */}
      <button
        type="button"
        onClick={handleToggle}
        disabled={!canToggle}
        aria-expanded={isExpanded}
        aria-label={
          canToggle ? toolToggleLabel(view.header.title, view.subtitle, isExpanded) : undefined
        }
        className={`flex w-full flex-wrap items-baseline gap-x-1 gap-y-0 rounded px-1 py-0.5 text-left text-[11.5px] leading-[1.55] transition-colors ${
          canToggle ? 'cursor-pointer hover:bg-ink/[0.03]' : 'cursor-default'
        } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20`}
      >
        <span className={`shrink-0 self-center ${tone}`} aria-hidden="true">
          {status.glyph}
        </span>
        <span className="sr-only">{status.word}</span>
        <span className="shrink-0 font-semibold text-info">{view.header.title}</span>
        {view.subtitle && (
          <>
            <span className="shrink-0 text-ink/25">:</span>
            <span className="min-w-0 flex-1 truncate text-meta">{view.subtitle}</span>
          </>
        )}
        <span className={`shrink-0 font-semibold ${tone}`}>{`[${status.word.toLowerCase()}]`}</span>
        {facts.length > 0 && (
          // Facts are the LAST thing on the line and they clip as a unit, so a
          // long `exit 1 · 412 B` can never widen the row past the panel —
          // measured at 390 the unbounded group ran the section to 459/362.
          // The whole group carries the tooltip with every fact, so a clipped
          // tail is still recoverable.
          <span
            className="min-w-0 shrink truncate text-[10.5px]"
            title={facts.map((fact) => fact.label).join(' · ')}
          >
            <span className="text-ink/25">· </span>
            <Facts facts={facts} max={HEAD_FACT_LIMIT} />
          </span>
        )}
        {canToggle && (
          <span className="ml-auto shrink-0 pl-1 text-ink/40" aria-hidden="true">
            {isExpanded ? '▾' : '▸'}
          </span>
        )}
      </button>

      {isExpanded && view.hasBody && (
        // Indentation, not a frame: the body hangs off the line the way a
        // terminal prints a command's output under it.
        <div className="mb-1.5 ml-2 space-y-3 border-l border-ink/10 py-1.5 pl-3 code-surface">
          <ToolBody tool={tool} view={view} />
        </div>
      )}
    </div>
  );
});
