/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The judge panel: two answers, one note.
 *
 * Fixed at the rectangle the click reported rather than tracking its block. A
 * rendered document rehydrates (mermaid, math, directives) and every hydrate
 * moves blocks, so anything that measured once and followed would drift away
 * from what it describes; a scroll closes it instead, which is also the moment
 * the block under it is no longer where the user is looking.
 *
 * The two answers are `aria-pressed` buttons, not a radio or a checkbox: the
 * pressed state IS the judgement, and a screen reader has to hear which one it
 * is without counting options.
 */

import { useEffect, useRef } from 'preact/hooks';
import { Check, X } from 'lucide-preact';

import type { BlockVerdict, MdBlock } from '@/shared/lib/markdown/blocks/types';
import { ACTION_CLASS } from '@/client/components/workspace/editor/toolbar-toggle';

interface ReviewPopoverProps {
  block: MdBlock;
  verdict: BlockVerdict | null;
  note: string;
  anchor: { top: number; left: number };
  onSave: (verdict: BlockVerdict, note: string) => void;
  onRemove: () => void;
  onClose: () => void;
}

function rangeOf(block: MdBlock): string {
  return block.lineStart === block.lineEnd ? `L${block.lineStart}` : `L${block.lineStart}-${block.lineEnd}`;
}

export function ReviewPopover({ block, verdict, note, anchor, onSave, onRemove, onClose }: ReviewPopoverProps) {
  // The whole panel is one form, so the draft lives in the DOM rather than in
  // state: two saves of the same block would otherwise need a re-seed effect,
  // and the `key` on this element already re-mounts it per block.
  const form = useRef<HTMLDivElement | null>(null);
  const field = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    field.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // `stopPropagation`, not `preventDefault`: Escape is also the panel's own
      // chord for closing the find bar, and the innermost scope must win.
      event.stopPropagation();
      onClose();
    };
    // Capture, so the panel's own keydown handler cannot consume it first.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const submit = (chosen: BlockVerdict) => onSave(chosen, field.current?.value ?? note);

  return (
    <div
      ref={form}
      role="dialog"
      aria-label={`Review block ${rangeOf(block)}`}
      // `fixed`, from the click's own rectangle — see the module note.
      style={{ top: `${anchor.top}px`, left: `${anchor.left}px` }}
      className="glass-popover fixed z-[65] w-[min(24rem,calc(100vw-2rem))] rounded-md border border-ink/15 bg-paper shadow-lg p-2 font-sans text-[11.5px] text-ink"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-center gap-1.5 text-[10.5px] font-mono text-ink/50">
        <span>{rangeOf(block)}</span>
        <span className="truncate">&laquo;{block.quote}&raquo;</span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto cursor-pointer text-ink/50 hover:text-ink"
          aria-label="Close review"
        >
          <X size={12} />
        </button>
      </div>

      <div className="mt-1.5 flex items-center gap-1.5">
        <button
          type="button"
          aria-pressed={verdict === 'good'}
          title="This block is good — do not change it"
          onClick={() => submit('good')}
          className={`${ACTION_CLASS} border px-2 text-[11px] ${
            verdict === 'good' ? 'border-ink bg-ink/10 text-ink' : 'border-ink/15 text-ink/70 hover:border-ink/40'
          }`}
        >
          <Check size={11} /> Good
        </button>
        <button
          type="button"
          aria-pressed={verdict === 'needs-work'}
          title="This block needs work"
          onClick={() => submit('needs-work')}
          className={`${ACTION_CLASS} border px-2 text-[11px] ${
            verdict === 'needs-work' ? 'border-error bg-error/10 text-error' : 'border-ink/15 text-ink/70 hover:border-ink/40'
          }`}
        >
          <X size={11} /> Needs work
        </button>
        {verdict && (
          <button
            type="button"
            onClick={onRemove}
            className={`${ACTION_CLASS} ml-auto border border-ink/15 px-2 text-[11px] text-ink/60 hover:text-error`}
          >
            Remove
          </button>
        )}
      </div>

      <textarea
        ref={field}
        defaultValue={note}
        rows={3}
        placeholder="What is wrong — or what is right — with this block…"
        onKeyDown={(event) => {
          // ⌘↵ saves the CURRENT verdict; a block with none is not saved by a
          // keystroke that cannot say which answer it means.
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && verdict) {
            event.preventDefault();
            submit(verdict);
          }
        }}
        className="mt-1.5 w-full resize-y rounded border border-ink/15 bg-canvas/40 px-2 py-1 text-[11px] font-sans outline-none focus:border-ink"
      />

      <div className="mt-1 flex items-center gap-1.5 text-[10.5px] text-ink/45">
        <span>Click an answer to save · ⌘↵ keeps the note with it</span>
      </div>
    </div>
  );
}
