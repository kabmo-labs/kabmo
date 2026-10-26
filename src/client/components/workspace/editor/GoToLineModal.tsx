/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Go to line (⌘G).
 *
 * A one-field dialog rather than a prompt, because the panel already has the modal
 * shell and because the two things that make this feature usable are both UI: the
 * field must be pre-selected (the user is typing a number, not editing text), and a
 * number past the end must be CLAMPED rather than refused — "go to the end" is what
 * a too-large number means.
 *
 * ## Why it goes through the surface handle
 *
 * `CodeSurfaceHandle` already has `select(offset, offset)` and `revealOffset`, which
 * is exactly "put the caret on this line and scroll it into view". Importing
 * CodeMirror here would be a second way into the same view, and the handle is the
 * contract that kept the find bar, the outline jump and the search reveal working
 * without knowing CM6 exists.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import type { TargetedKeyboardEvent } from 'preact';
import { CornerDownLeft } from 'lucide-preact';

import { Modal } from '@/client/components/common/Modal';

interface GoToLineModalProps {
  /** Total lines in the document, so a request can be clamped and named. */
  lineCount: number;
  onGo: (line: number) => void;
  onClose: () => void;
}

/**
 * The line a typed value resolves to.
 *
 * `null` for anything that is not a number, so the field can stay open with its
 * value untouched instead of jumping to line 1 on a typo.
 */
export function resolveLineRequest(raw: string, lineCount: number): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const requested = Number(trimmed);
  if (requested < 1) return null;
  // Clamped, not refused: a number past the end means "the end", which is the only
  // reading that does not waste the user's keystroke.
  return Math.min(requested, Math.max(lineCount, 1));
}

export function GoToLineModal({ lineCount, onGo, onClose }: GoToLineModalProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // Focus AND select: the field starts empty, and a re-open after a jump should
    // replace the previous number rather than append to it.
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = () => {
    const line = resolveLineRequest(value, lineCount);
    if (line === null) return;
    onGo(line);
  };

  const onKeyDown = (event: TargetedKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  const resolved = resolveLineRequest(value, lineCount);

  return (
    <Modal
      onClose={onClose}
      maxWidthClass="max-w-xs"
      header={<span className="text-sm font-semibold text-ink">Go to line</span>}
    >
      <div className="px-4 py-3 space-y-2">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            value={value}
            onInput={(event) => setValue((event.target as HTMLInputElement).value)}
            onKeyDown={onKeyDown}
            inputMode="numeric"
            placeholder="1"
            aria-label="Line number"
            className="flex-1 bg-paper border border-ink/20 rounded px-2 py-1 text-xs font-mono text-ink outline-none focus:border-ink/40"
          />
          <span className="text-[10px] font-mono text-ink/40">/ {lineCount}</span>
          <button
            type="button"
            onClick={submit}
            disabled={resolved === null}
            className="flex items-center gap-1 px-2 py-1 rounded bg-ink text-paper text-xs disabled:opacity-40 disabled:cursor-default cursor-pointer"
          >
            <CornerDownLeft size={12} />
            Go
          </button>
        </div>
        {/* The resolved line, so a clamped request says so before the jump. */}
        {value && resolved !== null && String(resolved) !== value.trim() ? (
          <div className="text-[10px] text-ink/50 font-mono">line {resolved} (the last line)</div>
        ) : null}
        {value && resolved === null ? (
          <div className="text-[10px] text-error font-mono">Enter a line number</div>
        ) : null}
      </div>
    </Modal>
  );
}
