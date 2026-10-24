/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'preact/hooks';
import type { ComponentChildren, TargetedKeyboardEvent } from 'preact';
import {
  ArrowDown,
  ArrowUp,
  CaseSensitive,
  ChevronDown,
  ChevronUp,
  Regex,
  Replace,
  ReplaceAll,
  WholeWord,
  X,
} from 'lucide-preact';

import { EDITOR_KEY_BINDINGS, type EditorCommand } from '@/shared/lib/code/editor/keymap';
import { describeBinding } from '@/shared/lib/ui/key-binding';
import { isMacPlatform } from '@/shared/lib/util/platform';
import type { EditorFindState } from '@/client/hooks/editor/use-editor-find';
import type { FindOptions } from '@/shared/lib/code/editor/find-scan';

const BUTTON_CLASS =
  'flex items-center justify-center p-1 rounded transition-colors cursor-pointer disabled:cursor-default disabled:opacity-40';

interface FindWidgetProps {
  find: EditorFindState;
}

/** One of the three toggle buttons: `aria-pressed` is the state, the title the shortcut. */
function ToggleButton({
  active,
  title,
  onToggle,
  children,
}: {
  active: boolean;
  title: string;
  onToggle: () => void;
  children: ComponentChildren;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`${BUTTON_CLASS} ${active ? 'bg-ink/10 text-ink' : 'text-ink/50 hover:text-ink hover:bg-ink/5'}`}
      title={title}
      aria-label={title}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

/**
 * The find/replace bar, pinned to the editor's top-right corner the way VS
 * Code pins it.
 *
 * Two rows, not one: the query and its toggles, then the replacement and the
 * two write actions. A single row would have to hide either the toggles or the
 * replace buttons, and both are things this bar exists to expose.
 *
 * The counts are the honest ones — `N of M`, `M+` past the match cap, and a
 * distinct message for a query that does not compile, because "no results" and
 * "your regex is broken" are different answers and the user has to be able to
 * tell them apart.
 */
export function FindWidget({ find }: FindWidgetProps) {
  const queryRef = useRef<HTMLInputElement | null>(null);
  const isMac = isMacPlatform();

  useEffect(() => {
    queryRef.current?.focus();
    queryRef.current?.select();
  }, [find.focusRequest]);

  const total = find.matches.length;
  const status = find.invalid
    ? 'Invalid pattern'
    : total === 0
      ? find.query
        ? 'No results'
        : ''
      : `${find.currentIndex + 1} of ${total}${find.truncated ? '+' : ''}`;

  const handleKeyDown = (e: TargetedKeyboardEvent<HTMLInputElement>) => {
    // Escape is NOT handled here: the editor panel owns it on the capture
    // phase (it has to work while focus is in the document too), and a second
    // handler here would be unreachable behind that one.
    // Enter / ⇧Enter step the matches while the focus stays in the field.
    if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      find.step(e.shiftKey ? -1 : 1);
    }
  };

  /** Tooltip text for a command: its palette label plus the chord it actually listens for. */
  const withChord = (command: EditorCommand, label: string) => {
    const binding = EDITOR_KEY_BINDINGS.find((entry) => entry.command === command);
    return binding ? `${label} (${describeBinding(binding, isMac)})` : label;
  };

  const optionButton = (key: keyof FindOptions, label: string, command: EditorCommand, icon: ComponentChildren) => (
    <ToggleButton active={find.options[key]} title={withChord(command, label)} onToggle={() => find.toggleOption(key)}>
      {icon}
    </ToggleButton>
  );

  return (
    // `w-[330px]` was wider than the panel's own default (320px), so the bar's
    // leftmost control — Show replace — hung past the panel's edge and its click
    // landed on whatever was beside it. A max width keeps the bar inside the
    // panel it belongs to at any width, and `min-w-0` lets the fields shrink
    // with it instead of pushing the buttons out.
    <div className="absolute top-2 right-2 z-30 flex w-[330px] max-w-[calc(100%-1rem)] min-w-0 flex-col gap-1 bg-paper border border-ink/15 rounded-md shadow-lg p-1.5 text-xs text-ink font-sans">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={find.toggleReplace}
          className={`${BUTTON_CLASS} ${find.replaceOpen ? 'text-ink' : 'text-ink/50 hover:text-ink hover:bg-ink/5'}`}
          title={find.replaceOpen ? 'Hide replace' : 'Show replace'}
          aria-label={find.replaceOpen ? 'Hide replace' : 'Show replace'}
          aria-pressed={find.replaceOpen}
        >
          {find.replaceOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>

        <input
          ref={queryRef}
          type="text"
          value={find.query}
          onInput={(e) => find.setQuery(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          placeholder="Find"
          aria-label="Find"
          className={`flex-1 min-w-0 bg-canvas border rounded px-2 py-1 font-mono text-xs focus:outline-none ${
            find.invalid ? 'border-error text-error' : 'border-ink/20 focus:border-ink text-ink'
          }`}
        />

        {optionButton('matchCase', 'Match case', 'toggleCaseSensitive', <CaseSensitive size={13} />)}
        {optionButton('wholeWord', 'Match whole word', 'toggleWholeWord', <WholeWord size={13} />)}
        {optionButton('isRegex', 'Use regular expression', 'toggleRegex', <Regex size={13} />)}

        <span
          className={`font-mono text-[10px] whitespace-nowrap min-w-[52px] text-right ${find.invalid ? 'text-error' : 'text-ink/50'}`}
          aria-live="polite"
        >
          {status}
        </span>

        <button
          type="button"
          onClick={() => find.step(-1)}
          disabled={total === 0}
          className={`${BUTTON_CLASS} text-ink/50 hover:text-ink hover:bg-ink/5`}
          title={withChord('previousMatch', 'Previous match')}
          aria-label="Previous match"
        >
          <ArrowUp size={13} />
        </button>
        <button
          type="button"
          onClick={() => find.step(1)}
          disabled={total === 0}
          className={`${BUTTON_CLASS} text-ink/50 hover:text-ink hover:bg-ink/5`}
          title={withChord('nextMatch', 'Next match')}
          aria-label="Next match"
        >
          <ArrowDown size={13} />
        </button>
        <button
          type="button"
          onClick={find.close}
          className={`${BUTTON_CLASS} text-ink/50 hover:text-ink hover:bg-ink/5`}
          title="Close find (Escape)"
          aria-label="Close find"
        >
          <X size={13} />
        </button>
      </div>

      {find.replaceOpen && (
        <div className="flex items-center gap-1">
          <span className="w-[22px]" aria-hidden="true" />
          <input
            type="text"
            value={find.replacement}
            onInput={(e) => find.setReplacement(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            placeholder="Replace"
            aria-label="Replace"
            className="flex-1 min-w-0 bg-canvas border border-ink/20 rounded px-2 py-1 font-mono text-xs text-ink focus:outline-none focus:border-ink"
          />
          <button
            type="button"
            onClick={find.replaceCurrent}
            disabled={total === 0}
            className={`${BUTTON_CLASS} text-ink/50 hover:text-ink hover:bg-ink/5`}
            title={withChord('replaceOne', 'Replace')}
            aria-label="Replace"
          >
            <Replace size={13} />
          </button>
          <button
            type="button"
            onClick={find.replaceAll}
            disabled={total === 0}
            className={`${BUTTON_CLASS} text-ink/50 hover:text-ink hover:bg-ink/5`}
            title={withChord('replaceAll', 'Replace all')}
            aria-label="Replace all"
          >
            <ReplaceAll size={13} />
          </button>
        </div>
      )}
    </div>
  );
}
