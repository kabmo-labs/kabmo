/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The command palette: one list for commands and files.
 *
 * It is mounted at the app root and PORTALED to `<body>`. A `fixed` overlay
 * inside the composer card would size itself to the card — the card is a
 * containing block through its own `backdrop-filter` — which is the measured
 * failure `composer-portal.test.tsx` guards against.
 *
 * The list is a real listbox: the input is a combobox that owns
 * `aria-activedescendant`, so a screen reader announces the highlighted row
 * instead of reading the whole list on every arrow key.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { CornerDownLeft, Search } from 'lucide-preact';
import { closePalette, type PaletteMode } from '@/client/lib/commands/overlays';
import { chordForCommand } from '@/client/lib/commands/keymap';
import { formatChord } from '@/shared/lib/commands/chord';
import { isMacPlatform } from '@/shared/lib/util/platform';
import { useOverlays } from '@/client/hooks/commands/use-overlays';
import { usePaletteItems, type PaletteItem } from '@/client/hooks/commands/use-palette-items';
import { openFileInEditor } from '@/client/hooks/ui/open-file';
import { useDialogBehaviour } from '@/client/hooks/ui/dialog-behaviour';
import { pluginContext } from '@/client/lib/plugins/context';

const ROW_ID = 'command-palette-row';

export function CommandPalette() {
  const { palette } = useOverlays();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  // The same focus trap and focus-return every dialog uses. Escape is handled
  // by the input first; this is the Tab wrap and the return to the opener.
  useDialogBehaviour(panelRef, { open: palette.open, onClose: closePalette });

  const mode: PaletteMode = query.startsWith('>') ? 'commands' : palette.mode;
  const effectiveQuery = query.startsWith('>') ? query.slice(1) : query;
  const { items, loading, error } = usePaletteItems(mode, effectiveQuery, palette.context, palette.open);

  useEffect(() => {
    if (!palette.open) return;
    setQuery('');
    setActiveIndex(0);
    inputRef.current?.focus();
  }, [palette.open, palette.mode]);

  useEffect(() => {
    setActiveIndex((previous) => Math.min(previous, Math.max(items.length - 1, 0)));
  }, [items.length]);

  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const activeId = items.length > 0 ? `${ROW_ID}-${activeIndex}` : undefined;

  if (!palette.open) return null;

  const commit = (item: PaletteItem | undefined) => {
    if (!item) return;
    if (item.kind === 'command') {
      if (item.disabled) return;
      closePalette();
      item.run();
      return;
    }
    closePalette();
    openFileInEditor({ path: item.path, root: pluginContext().workspacePath ?? undefined });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((previous) => (items.length === 0 ? 0 : (previous + 1) % items.length));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((previous) => (items.length === 0 ? 0 : (previous - 1 + items.length) % items.length));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      commit(items[activeIndex]);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closePalette();
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center pt-[12vh] bg-ink/20"
      onClick={closePalette}
      data-command-palette
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-[560px] max-w-[92vw] glass-overlay bg-paper border border-ink/15 rounded-xl shadow-2xl flex flex-col overflow-hidden text-ink"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-ink/10">
          <Search size={14} className="text-ink/40 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-list"
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            value={query}
            onInput={(event) => {
              setQuery(event.currentTarget.value);
              setActiveIndex(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={mode === 'files' ? 'Search files by name' : 'Type a command'}
            aria-label={mode === 'files' ? 'Search files' : 'Search commands'}
            className="flex-1 min-w-0 bg-transparent text-sm font-sans text-ink focus:outline-none placeholder-ink/40"
          />
          <span className="text-[10px] font-mono text-ink/40 flex-shrink-0">
            {mode === 'files' ? 'files' : 'commands'}
          </span>
        </div>

        <div
          ref={listRef}
          id="command-palette-list"
          role="listbox"
          aria-label={mode === 'files' ? 'Files' : 'Commands'}
          className="max-h-[46vh] overflow-y-auto py-1"
        >
          {mode === 'files' && error ? (
            <div className="px-3 py-4 text-center text-xs text-ink/50 font-sans">{error}</div>
          ) : mode === 'files' && loading ? (
            <div className="px-3 py-4 text-center text-xs text-ink/50 font-sans">Reading the workspace…</div>
          ) : items.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-ink/50 font-sans">
              {mode === 'files' ? 'No matching file' : 'No matching command'}
            </div>
          ) : (
            items.map((item, index) => (
              <button
                key={item.kind === 'command' ? item.id : item.path}
                id={`${ROW_ID}-${index}`}
                data-index={index}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                aria-disabled={item.kind === 'command' && item.disabled ? true : undefined}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => commit(item)}
                className={`w-full flex items-center justify-between gap-3 px-3 py-1.5 text-left text-xs font-sans transition-colors ${
                  index === activeIndex ? 'bg-ink/5 text-ink' : 'text-ink/80'
                } ${item.kind === 'command' && item.disabled ? 'opacity-45' : ''}`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  {index === activeIndex ? (
                    <CornerDownLeft size={12} className="text-ink/40 flex-shrink-0" />
                  ) : (
                    <span className="w-3 flex-shrink-0" />
                  )}
                  <span className="truncate">
                    {item.kind === 'command' ? item.title : item.name}
                    {item.kind === 'file' && item.directory ? (
                      <span className="text-ink/40"> — {item.directory}</span>
                    ) : null}
                  </span>
                  {item.kind === 'command' && item.disabled ? (
                    <span className="text-[10px] text-ink/40 flex-shrink-0">{item.disabled}</span>
                  ) : null}
                </span>
                <span className="flex items-center gap-2 flex-shrink-0">
                  {item.kind === 'command' ? (
                    <span className="text-[10px] text-ink/40">{item.category}</span>
                  ) : null}
                  {item.kind === 'command' && item.chord ? (
                    <span className="font-mono text-[10px] text-ink/50">{item.chord}</span>
                  ) : null}
                </span>
              </button>
            ))
          )}
        </div>

        <div className="px-3 py-1.5 border-t border-ink/10 flex items-center justify-between text-[10px] text-ink/40 font-sans">
          <span>↑↓ navigate · ↵ run · esc close</span>
          <span className="font-mono">
            {(() => {
              const chord = chordForCommand(mode === 'files' ? 'workspace.quickOpen' : 'workspace.commandPalette');
              return chord ? formatChord(chord, isMacPlatform()) : '';
            })()}
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
