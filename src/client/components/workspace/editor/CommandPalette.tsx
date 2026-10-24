/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The editor's command palette (⌘⇧P).
 *
 * Every editor command this app implements is listed here with the chord that
 * reaches it, both derived from the same keymap table the editor binds against.
 * The palette is therefore a VIEW of the keymap rather than a second
 * list to keep in sync — a command cannot be listed here and unbound there, and
 * a chord cannot be shown that does not work.
 *
 * Commands this editor deliberately does not have (folding, go-to-definition,
 * the `⌘K` prefix chords) are absent rather than listed and inert: a palette
 * entry that does nothing is worse than no entry, because the user concludes
 * the editor is broken rather than that the feature is missing.
 */

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { TargetedKeyboardEvent } from 'preact';
import { CornerDownLeft, Search } from 'lucide-preact';

import { isFindBarCommand, type EditorCommand } from '@/shared/lib/code/editor/keymap';
import { buildPaletteEntries, filterPaletteEntries, type PaletteEntry } from '@/shared/lib/code/editor/palette';
import { isMacPlatform } from '@/shared/lib/util/platform';

interface CommandPaletteProps {
  onRun: (command: EditorCommand) => void;
  onClose: () => void;
}

export function CommandPalette({ onRun, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Built once per mount from the keymap, so a filter can never offer something
  // the keymap does not have.
  const entries = useMemo(() => buildPaletteEntries(isMacPlatform()), []);
  const matches = useMemo(() => filterPaletteEntries(entries, query), [entries, query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Keep the highlighted row in view while the filter shrinks the list under it.
  useEffect(() => {
    const list = listRef.current;
    const active = list?.children[activeIndex] as HTMLElement | undefined;
    active?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, matches.length]);

  useEffect(() => {
    setActiveIndex((previous) => Math.min(previous, Math.max(matches.length - 1, 0)));
  }, [matches.length]);

  const commit = (entry: PaletteEntry | undefined) => {
    if (!entry) return;
    onClose();
    onRun(entry.command);
  };

  const handleKeyDown = (event: TargetedKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((previous) => (matches.length === 0 ? 0 : (previous + 1) % matches.length));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((previous) => (matches.length === 0 ? 0 : (previous - 1 + matches.length) % matches.length));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      commit(matches[activeIndex]);
      return;
    }
    if (event.key === 'Escape') {
      // Handled on the panel's capture phase, but stopping here too keeps the
      // key from reaching the document if the palette is ever mounted alone.
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };

  return (
    <div className="absolute inset-0 z-40 flex items-start justify-center pt-12 bg-ink/10" onClick={onClose}>
      <div
        className="w-[520px] max-w-[92%] bg-paper border border-ink/15 rounded-lg shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 py-2 border-b border-ink/10">
          <Search size={14} className="text-ink/40 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onInput={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command or a shortcut"
            aria-label="Command palette"
            className="flex-1 min-w-0 bg-transparent text-xs font-sans text-ink focus:outline-none placeholder-ink/40"
          />
        </div>

        <div ref={listRef} className="max-h-[320px] overflow-y-auto py-1">
          {matches.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-ink/40 font-sans">No matching command</div>
          ) : (
            matches.map((entry, index) => (
              <button
                key={entry.command}
                type="button"
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => commit(entry)}
                className={`w-full flex items-center justify-between gap-3 px-3 py-1.5 text-left text-xs font-sans transition-colors ${
                  index === activeIndex ? 'bg-ink/5 text-ink' : 'text-ink/80'
                }`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  {index === activeIndex ? <CornerDownLeft size={12} className="text-ink/40 flex-shrink-0" /> : <span className="w-3" />}
                  <span className="truncate">{entry.label}</span>
                  {isFindBarCommand(entry.command) ? <span className="text-[10px] text-ink/40 flex-shrink-0">find bar</span> : null}
                </span>
                <span className="font-mono text-[10px] text-ink/50 flex-shrink-0">{entry.chord}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
