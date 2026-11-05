/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Naming one mark: which part of the page it is, what is wrong there, and what
 * the panel could read underneath it.
 *
 * The label is the user's own vocabulary and is always available; the element
 * is only available when the frame happens to be same-origin. Those are two
 * different facts and the panel states them separately — a missing element is
 * never rendered as a blank or as "unknown", because the reason (cross-origin,
 * or nothing under the mark) changes what the agent should do next.
 */

import { ANNOTATE_LABEL_SUGGESTIONS, ANNOTATE_TOOL_LABEL } from '@/shared/lib/browser/annotate';
import type { AnnotateShape } from '@/shared/types';
import type { ElementAtResult } from '@/client/lib/browser/element-at';

interface AnnotateTargetProps {
  shape: AnnotateShape;
  index: number;
  /** The last element resolution, which is what says WHY an element is absent. */
  readability: ElementAtResult | null;
  onLabel: (label: string) => void;
  onNote: (note: string) => void;
}

const FIELD =
  'w-full min-w-0 bg-canvas border border-ink/15 rounded px-2 py-1 text-[11px] font-mono text-ink placeholder:text-ink/35 focus:outline-none focus:border-ink/40';

/** Why the marked spot carries no element, in words the user can act on. */
export function missingElementReason(readability: ElementAtResult | null): string | null {
  if (!readability || readability.ok) return null;
  if (readability.reason === 'cross-origin') return 'This page is cross-origin, so its elements cannot be read. Name the part and add a note instead.';
  if (readability.reason === 'no-frame') return 'The page has not loaded, so its elements cannot be read yet.';
  return 'There is no element at this point (empty space). Name the part instead.';
}

export function AnnotateTarget({ shape, index, readability, onLabel, onNote }: AnnotateTargetProps) {
  const reason = missingElementReason(readability);
  const element = shape.element;

  return (
    <div className="flex items-start gap-1.5 min-w-0">
      <span className="text-[11px] font-mono text-ink/45 pt-1 flex-shrink-0">
        {ANNOTATE_TOOL_LABEL[shape.tool]} #{index}
      </span>

      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[10px] uppercase font-mono text-ink/40">bagian</span>
          {ANNOTATE_LABEL_SUGGESTIONS.map((suggestion) => {
            const picked = shape.label === suggestion;
            return (
              <button
                key={suggestion}
                type="button"
                onClick={() => onLabel(picked ? '' : suggestion)}
                aria-pressed={picked}
                className={`px-1.5 py-0.5 rounded-full border text-[10px] font-mono transition-colors cursor-pointer ${
                  picked ? 'bg-ink text-canvas border-ink' : 'bg-canvas text-ink/65 border-ink/15 hover:border-ink/40'
                }`}
              >
                {suggestion}
              </button>
            );
          })}
          <input
            value={shape.label}
            onInput={(event) => onLabel(event.currentTarget.value)}
            placeholder="or type your own…"
            aria-label="Name of the marked part"
            spellcheck={false}
            className={`${FIELD} flex-1 min-w-[110px]`}
          />
        </div>

        <textarea
          value={shape.note}
          onInput={(event) => onNote(event.currentTarget.value)}
          placeholder="What is wrong with this part? (e.g. the Pay button looks disabled)"
          rows={2}
          aria-label="Annotation note"
          className={`${FIELD} resize-y`}
        />

        {element ? (
          <p className="text-[10px] font-mono text-ink/45 truncate" title={element.path}>
            elemen: {element.path}
            {element.state ? ` · ${element.state}` : ''}
          </p>
        ) : null}
        {reason ? <p className="text-[10px] text-ink/40">{reason}</p> : null}
      </div>
    </div>
  );
}
