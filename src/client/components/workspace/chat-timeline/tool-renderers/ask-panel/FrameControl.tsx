/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The control for the dialog omp is currently blocked on.
 *
 * The option list is rendered from the FRAME, never from the tool arguments:
 * omp decorates it on its way out — ` (Recommended)` on the suggested choice,
 * `Other (type your own)` appended to every question, and whichever label ends a
 * multi-select sweep — and those exact strings are what omp compares a response
 * against. Reproducing them locally would only risk sending a label omp does not
 * recognise.
 */

import { useEffect, useState } from 'preact/hooks';
import { Check, CornerDownLeft } from 'lucide-preact';
import type { ExtensionUiDialogRequest } from '@/shared/types/omp/agent';
import { isOtherOption } from '@/shared/lib/chat/ask-questions';
import { OptionRow } from '@/client/components/workspace/chat-timeline/tool-renderers/ask-panel/OptionRow';
import type { ExtensionDialogResponse } from '@/client/components/workspace/chat-timeline/tool-renderers/extension-dialog/Lazy';

interface FrameControlProps {
  frame: ExtensionUiDialogRequest;
  /** Question picks several options, so every row toggles instead of answering. */
  multi: boolean;
  /** Labels already toggled on a multi-select question — display only. */
  selected: string[];
  /** Commit a single-choice answer; sent as soon as omp is listening for it. */
  onAnswer: (value: string) => void;
  /** Send one multi-select toggle. */
  onToggle: (label: string) => void;
  /** Answer a dialog that is not a choice list (confirm / input / editor). */
  onRespond: (response: ExtensionDialogResponse) => void;
}

const RECOMMENDED = / \(recommended\)$/i;
const DONE_ROW = /\bdone\b/i;

export function FrameControl({ frame, multi, selected, onAnswer, onToggle, onRespond }: FrameControlProps) {
  const [text, setText] = useState('');
  // A new dialog reuses this component; text left over from the previous one
  // must not read as an answer the user just typed.
  useEffect(() => {
    setText(frame.method === 'editor' ? frame.prefill ?? '' : '');
  }, [frame.id, frame.method, frame.prefill]);

  if (frame.method === 'confirm') {
    return (
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onRespond({ confirmed: true })}
          className="flex cursor-pointer items-center gap-1.5 rounded-md bg-ink px-3 py-1 text-[11.5px] font-semibold text-paper transition-opacity hover:opacity-90"
        >
          <Check size={11} />
          <span>Confirm</span>
        </button>
        <button
          type="button"
          onClick={() => onRespond({ confirmed: false })}
          className="cursor-pointer rounded-md border border-ink/15 px-3 py-1 text-[11.5px] font-medium text-ink/70 transition-colors hover:border-ink/30 hover:text-ink"
        >
          Decline
        </button>
      </div>
    );
  }

  if (frame.method === 'input' || frame.method === 'editor') {
    return (
      <div className="mt-2 space-y-1.5">
        {frame.title && <div className="text-[10.5px] text-ink/45">{frame.title}</div>}
        {frame.method === 'editor' ? (
          <textarea
            autoFocus
            value={text}
            onChange={(event) => setText(event.currentTarget.value)}
            rows={4}
            placeholder={frame.placeholder || 'Type your answer…'}
            className="w-full rounded-md border border-ink/15 bg-canvas/40 px-2.5 py-1.5 font-mono text-[11.5px] leading-relaxed text-ink outline-none focus:border-ink"
          />
        ) : (
          <input
            autoFocus
            type={frame.secret === true ? 'password' : 'text'}
            value={text}
            placeholder={frame.placeholder || 'Type your answer…'}
            onChange={(event) => setText(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              onRespond({ value: text });
            }}
            className="w-full rounded-md border border-ink/15 bg-canvas/40 px-2.5 py-1.5 text-[11.5px] text-ink outline-none focus:border-ink"
          />
        )}
        <button
          type="button"
          onClick={() => onRespond({ value: text })}
          className="flex cursor-pointer items-center gap-1.5 rounded-md bg-ink px-3 py-1 text-[11.5px] font-semibold text-paper transition-opacity hover:opacity-90"
        >
          <span>Submit</span>
          <CornerDownLeft size={11} className="opacity-70" />
        </button>
      </div>
    );
  }

  const options = frame.options ?? [];
  const details = frame.optionDetails ?? [];
  if (frame.method !== 'select' || options.length === 0) return null;

  return (
    <div className="mt-2 space-y-1" role={multi ? 'group' : 'radiogroup'}>
      {options.map((label, index) => {
        // A single-choice question resolves "Other" to the typed text, so the
        // row itself is a prompt to type — never a literal answer.
        if (!multi && isOtherOption(label)) return null;
        const checked = multi && selected.includes(label);
        const finish = multi && DONE_ROW.test(label);
        return (
          <OptionRow
            key={label}
            label={label}
            description={details[index]?.description}
            multi={multi}
            checked={checked}
            suggested={RECOMMENDED.test(label) && !multi}
            emphasis={finish}
            onClick={() => (multi ? (finish ? onRespond({ value: label }) : onToggle(label)) : onAnswer(label))}
          />
        );
      })}

      {!multi && (
        <input
          value={text}
          placeholder="Other — type your own answer…"
          onChange={(event) => setText(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || !text.trim()) return;
            event.preventDefault();
            onAnswer(text.trim());
          }}
          className="w-full rounded-md border border-ink/15 bg-canvas/40 px-2.5 py-1.5 text-[11.5px] text-ink outline-none focus:border-ink"
        />
      )}
    </div>
  );
}
