/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The fact chips a collapsed tool card shows.
 *
 * `toolSummary` decides WHAT is worth saying (pure, tested in `shared/lib`);
 * this module decides how it looks. Splitting them keeps the presentation table
 * in one place — an icon per fact kind and a tone per tone — so a `bash` exit
 * code and an `edit` diagnostic count read as the same family of statement
 * instead of each panel inventing its own.
 *
 * Nothing here truncates silently: a chip whose label is elided carries the
 * full text in `title`, because the header clips the row on a narrow panel and
 * a clipped fact with no tooltip is a fact the reader cannot recover.
 */

import type { ReactNode } from 'preact/compat';
import {
  AlertTriangle,
  Clock,
  HardDrive,
  Hash,
  Info,
  ListTodo,
  Quote,
  Rows,
} from 'lucide-preact';
import type { ToolFact } from '@/shared/lib/chat/tool/summary';

/** Chip kind → glyph. Every kind is here except the ones in `ICONLESS_KINDS`. */
const ICON_BY_KIND: Record<ToolFact['kind'], ReactNode> = {
  exit: <Hash size={10} />,
  time: <Clock size={10} />,
  size: <HardDrive size={10} />,
  range: <Rows size={10} />,
  count: <Hash size={10} />,
  diff: null,
  progress: <ListTodo size={10} />,
  subject: <Quote size={10} />,
  warn: <AlertTriangle size={10} />,
  note: <Info size={10} />,
};

/** Chip tone → class list. `muted` is the default and needs no entry.
 *  A toned chip is text-only: no background, because the tint was louder than
 *  the fact and the ink palette has no room for a filled pill in a dense row. */
const TONE_CLASSES: Record<NonNullable<ToolFact['tone']> & ('ok' | 'warn' | 'error'), string> = {
  ok: 'text-success',
  warn: 'text-warning',
  error: 'text-error',
};

/** Per-segment colour for a fact's `parts`. */
const PART_CLASSES: Record<'ok' | 'error', string> = {
  ok: 'text-success',
  error: 'text-error',
};

/** A fact that is a verdict reads as a badge; a fact that is a measurement does
 *  not — an `exit 0` and a `+4 −1` are not the same claim. */
const BADGE_KINDS: ReadonlySet<ToolFact['kind']> = new Set(['exit', 'diff', 'progress', 'warn']);

/** Kinds whose glyph adds nothing: the label already says it, and a diff chip
 *  reads better as `+43 −16` alone than behind a file glyph. */
const ICONLESS_KINDS: ReadonlySet<ToolFact['kind']> = new Set(['diff']);

function chipClass(fact: ToolFact): string {
  const base = 'inline-flex shrink-0 items-center gap-1 px-1 py-0.5 font-mono text-[9.5px]';
  if (fact.parts && fact.parts.length > 0) return `${base} font-semibold text-ink/60`;
  if (fact.tone && fact.tone !== 'muted') return `${base} font-semibold ${TONE_CLASSES[fact.tone]}`;
  if (BADGE_KINDS.has(fact.kind)) return `${base} font-semibold text-ink/60`;
  return `${base} text-ink/45`;
}

/** The chip's text: colored segments when it has them, else the plain label. */
function FactLabel({ fact }: { fact: ToolFact }) {
  if (fact.parts && fact.parts.length > 0) {
    return (
      <>
        {fact.parts.map((part, index) => (
          <span key={`${part.label}-${index}`} className={`font-semibold ${PART_CLASSES[part.tone]}`}>
            {part.label}
          </span>
        ))}
      </>
    );
  }
  return <span className="truncate">{fact.label}</span>;
}

/** The chips for one tool call's facts, in the order `toolSummary` produced. */
export function ToolFactChips({ facts, max = 4 }: { facts: ToolFact[]; max?: number }) {
  if (facts.length === 0) return null;
  const shown = facts.slice(0, max);
  const overflow = facts.length - shown.length;

  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {shown.map((fact, index) => (
        <span key={`${fact.kind}-${index}`} className={chipClass(fact)} title={fact.title ?? fact.label}>
          {!ICONLESS_KINDS.has(fact.kind) && (
            <span className="text-ink/40" aria-hidden="true">
              {ICON_BY_KIND[fact.kind]}
            </span>
          )}
          <FactLabel fact={fact} />
        </span>
      ))}
      {overflow > 0 && (
        <span className="shrink-0 font-mono text-[9.5px] text-ink/35">+{overflow}</span>
      )}
    </span>
  );
}
