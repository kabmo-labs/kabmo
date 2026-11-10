import { Check, ClipboardCopy, ClipboardPaste } from 'lucide-preact';
import { useState } from 'preact/hooks';
import {
  TERMINAL_KEYS,
  TERMINAL_SYMBOLS,
  type TerminalKeyId,
  type TerminalModifier,
  type TerminalModifiers,
} from '@/shared/lib/workspace/terminal/keys';

interface TerminalKeyBarProps {
  /** Latched modifiers — a tap arms one, and the next key consumes it. */
  modifiers: TerminalModifiers;
  onToggleModifier: (modifier: TerminalModifier) => void;
  onKey: (id: TerminalKeyId) => void;
  /** Cmd+C in a terminal: copy the selection. Resolves false when there was none. */
  onCopy: () => Promise<boolean>;
  /** Cmd+V in a terminal: paste into the shell. Resolves false on a denied clipboard. */
  onPaste: () => Promise<boolean>;
  /** The shell is not running; a key would be sent into nothing. */
  disabled?: boolean;
}

const MODIFIERS: readonly { modifier: TerminalModifier; label: string; name: string }[] = [
  { modifier: 'ctrl', label: 'Ctrl', name: 'Ctrl — applies to the next key' },
  { modifier: 'alt', label: 'Alt', name: 'Alt / meta — applies to the next key' },
];

const KEY_CLASS =
  'flex items-center justify-center h-8 min-w-8 px-1.5 rounded border font-mono transition-colors ' +
  'cursor-pointer select-none disabled:opacity-40 disabled:cursor-default ' +
  'text-[11px] @[420px]:h-9 @[420px]:min-w-10 @[420px]:text-xs';

const IDLE_CLASS = 'bg-canvas text-ink/80 border-ink/15 hover:text-ink hover:bg-ink/5 active:bg-ink/10';
const ARMED_CLASS = 'bg-ink text-canvas border-ink';

/**
 * The keys a phone's soft keyboard does not have.
 *
 * Every button sends raw bytes into the live PTY, so what the shell sees is
 * identical to a physical keypress (the encoding, and the three rules it obeys,
 * are in `keys.ts`). Ctrl and Alt are LATCHES rather than keys: tapping one arms
 * it, and the next thing you send — a button here or a letter typed on the soft
 * keyboard — carries it, which is the only way a phone reaches Ctrl+C, Ctrl+R
 * or Alt+B.
 *
 * **Copy and Paste stand in for Cmd+C / Cmd+V**, which is what those chords mean
 * in a terminal and the one thing a phone genuinely cannot do: it has no
 * selection to right-click and no paste without a long-press the terminal canvas
 * does not offer. There is no raw Cmd button because the renderer treats Cmd as
 * the host's modifier, not the terminal's: a printable character with `metaKey`
 * set sends nothing (`isPrintableCharacter` returns false), and Cmd+C / Cmd+V
 * are its own copy and paste. A Cmd button would therefore send nothing, while
 * the Cmd chords the user does have keep working untouched. Copy reports when
 * there was no selection rather than flashing a check for a clipboard it did not
 * fill.
 *
 * `pointerdown` is swallowed so tapping a key never moves focus out of the
 * renderer's hidden input: blurring it closes the OS keyboard, and a key bar
 * that makes the keyboard disappear is worse than no key bar.
 *
 * Wrapping, not horizontal scrolling. The diff toolbar taught that a
 * `no-scrollbar` overflow hides actions with nothing on screen to say so
 * (measured: 361px of content in a 296px box, the last action entirely
 * outside); a narrow panel here gets three rows of keys instead, and the
 * container query grows them back on a wide one. The container is this bar's
 * own root, so the breakpoints follow the PANEL — 320px on a desktop is the
 * same problem as 320px on a phone.
 */
export function TerminalKeyBar({
  modifiers,
  onToggleModifier,
  onKey,
  onCopy,
  onPaste,
  disabled,
}: TerminalKeyBarProps) {
  const [symbols, setSymbols] = useState(false);
  const [feedback, setFeedback] = useState<'copied' | 'empty' | 'pasteFailed' | null>(null);
  const latched = modifiers.ctrl || modifiers.alt;

  const flash = (next: typeof feedback) => {
    setFeedback(next);
    setTimeout(() => setFeedback((current) => (current === next ? null : current)), 1500);
  };

  const handleCopy = async () => {
    flash((await onCopy()) ? 'copied' : 'empty');
  };

  const handlePaste = async () => {
    if (!(await onPaste())) flash('pasteFailed');
  };

  return (
    <div
      className="@container flex flex-col gap-1 px-2 py-1.5 border-t border-ink/10 bg-paper flex-shrink-0"
      onPointerDown={(event) => event.preventDefault()}
    >
      {/* Action row: the two latches, the Cmd pair, and the layer switch. */}
      <div className="flex flex-wrap items-center gap-1">
        {MODIFIERS.map(({ modifier, label, name }) => (
          <button
            key={modifier}
            type="button"
            onClick={() => onToggleModifier(modifier)}
            aria-pressed={modifiers[modifier]}
            title={name}
            aria-label={name}
            className={`${KEY_CLASS} ${modifiers[modifier] ? ARMED_CLASS : IDLE_CLASS}`}
          >
            {label}
          </button>
        ))}

        {/* A latch is armed, so say so: an invisible Ctrl turns the next tap into
            a signal the user never asked for. */}
        {latched && (
          <span className="text-[10px] font-mono text-ink/50 px-0.5 whitespace-nowrap" aria-hidden>
            next
          </span>
        )}

        <span className="w-px h-5 bg-ink/15 flex-shrink-0" aria-hidden />

        <button
          type="button"
          onClick={handleCopy}
          disabled={disabled}
          title={feedback === 'empty' ? 'Nothing selected' : 'Copy selection'}
          aria-label="Copy selection"
          className={`${KEY_CLASS} ${
            feedback === 'empty'
              ? 'bg-warning/10 text-warning border-warning/30'
              : IDLE_CLASS
          }`}
        >
          {feedback === 'copied' ? <Check size={13} /> : <ClipboardCopy size={13} />}
          {/* Labelled, not icon-only: `ClipboardCopy` and `ClipboardPaste` are
              the same 13px clipboard silhouette at a glance, so on a phone the
              pair read as two identical buttons — the one thing a key bar must
              never be. The label is what makes them tell themselves apart. */}
          <span className="pl-1">Copy</span>
        </button>

        <button
          type="button"
          onClick={handlePaste}
          disabled={disabled}
          title={feedback === 'pasteFailed' ? 'Clipboard unavailable' : 'Paste into the shell'}
          aria-label="Paste into the shell"
          className={`${KEY_CLASS} ${
            feedback === 'pasteFailed'
              ? 'bg-error/10 text-error border-error/30'
              : IDLE_CLASS
          }`}
        >
          <ClipboardPaste size={13} />
          <span className="pl-1">Paste</span>
        </button>

        <button
          type="button"
          onClick={() => setSymbols((previous) => !previous)}
          aria-pressed={symbols}
          title={symbols ? 'Show control keys' : 'Show symbols'}
          aria-label={symbols ? 'Show control keys' : 'Show symbols'}
          className={`${KEY_CLASS} ml-auto ${symbols ? ARMED_CLASS : IDLE_CLASS}`}
        >
          {/* `123` / `ABC`, the labels every phone keyboard already uses for its
              own symbol layer. An icon here was a metaphor the user had to
              decode; the convention needs no decoding. */}
          {symbols ? 'ABC' : '123'}
        </button>
      </div>

      {/* Key row: the same set swaps in place, the way a phone keyboard's own
          layer key works — two sets stacked would cost the canvas twice. */}
      <div className="flex flex-wrap items-center gap-1">
        {(symbols ? TERMINAL_SYMBOLS : TERMINAL_KEYS).map((def) => (
          <button
            key={def.id}
            type="button"
            disabled={disabled}
            onClick={() => onKey(def.id)}
            title={def.name}
            aria-label={def.name}
            className={`${KEY_CLASS} ${IDLE_CLASS}`}
          >
            {def.label}
          </button>
        ))}
      </div>
    </div>
  );
}
