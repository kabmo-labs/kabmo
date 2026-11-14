/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One chord recorder.
 *
 * Two strokes are supported because the keymap supports them: the first stroke
 * waits, a second completes the chord, and Enter keeps the single stroke. That
 * is explicit rather than timed — a timeout would commit a one-stroke binding
 * the user was still thinking about.
 *
 * Escape cancels, Backspace/Delete unbinds. The recorder stops propagation so
 * the global dispatcher cannot run the very command being recorded.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { formatChord, chordToText, strokeOfEvent } from '@/shared/lib/commands/chord';
import { isMacPlatform } from '@/shared/lib/util/platform';
import type { KeyStroke } from '@/shared/lib/ui/key-binding';
import { isModifierKey } from '@/shared/lib/commands/record';

interface KeyRecorderProps {
  /** The chord as printed, or empty when unbound. */
  chord: string;
  onCommit: (text: string | null) => void;
}

export function KeyRecorder({ chord, onCommit }: KeyRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [pending, setPending] = useState<KeyStroke[]>([]);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (recording) buttonRef.current?.focus();
  }, [recording]);

  const stop = () => {
    setRecording(false);
    setPending([]);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!recording) return;
    event.preventDefault();
    event.stopPropagation();

    if (event.key === 'Escape') {
      stop();
      return;
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
      if (pending.length === 0) {
        onCommit(null);
        stop();
      } else {
        setPending([]);
      }
      return;
    }
    if (event.key === 'Enter' && pending.length === 1) {
      onCommit(chordToText(pending));
      stop();
      return;
    }
    if (isModifierKey(event)) return;

    const stroke = strokeOfEvent(event);
    if (pending.length === 0) {
      setPending([stroke]);
      return;
    }
    onCommit(chordToText([pending[0], stroke]));
    stop();
  };

  const label = recording
    ? pending.length > 0
      ? `${formatChord(pending, isMacPlatform())} …`
      : 'Press keys…'
    : chord || 'Unassigned';

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={() => {
        setRecording(true);
        setPending([]);
      }}
      onBlur={() => {
        if (recording) stop();
      }}
      onKeyDown={onKeyDown}
      aria-label={recording ? 'Recording shortcut, press keys' : `Shortcut ${chord || 'unassigned'}, click to change`}
      className={`min-w-[7rem] px-2 py-1 rounded-md border text-[11px] font-mono transition-colors ${
        recording
          ? 'border-ink/60 bg-ink/5 text-ink'
          : 'border-ink/20 text-ink/70 hover:border-ink/40 hover:text-ink'
      }`}
    >
      {label}
    </button>
  );
}
