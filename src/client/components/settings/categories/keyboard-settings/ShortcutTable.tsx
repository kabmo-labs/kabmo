/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The shortcut table: every command, its chord, and the two edits a user can
 * make — rebind and reset.
 *
 * A command with no chord is listed too. That is the difference between this
 * table and the old palette: the palette could only offer what already had a
 * shortcut, so a command without one was unreachable from the UI entirely.
 */

import { useMemo, useState } from 'preact/hooks';
import { RotateCcw, Search } from 'lucide-preact';
import { findConflicts } from '@/shared/lib/commands/conflicts';
import { formatChord } from '@/shared/lib/commands/chord';
import { writeUserKeybindings } from '@/shared/lib/commands/user-keybindings';
import type { UserKeybindings } from '@/shared/lib/commands/types';
import { isMacPlatform } from '@/shared/lib/util/platform';
import { setUserKeybindings, userKeybindings } from '@/client/lib/commands/keymap';
import { useCommandCatalog } from '@/client/hooks/commands/use-command-catalog';
import { KeyRecorder } from '@/client/components/settings/categories/keyboard-settings/KeyRecorder';

export function ShortcutTable() {
  const { commands, chords, rules } = useCommandCatalog();
  const [overrides, setOverrides] = useState<UserKeybindings>(() => userKeybindings());
  const [query, setQuery] = useState('');

  const conflicts = useMemo(() => findConflicts(rules), [rules]);
  const isMac = isMacPlatform();
  const titleOf = (id: string) => commands.find((command) => command.id === id)?.title ?? id;

  const commit = (id: string, text: string | null) => {
    const next = { ...overrides, [id]: text };
    setOverrides(next);
    setUserKeybindings(next);
    writeUserKeybindings(next);
  };

  const reset = (id: string) => {
    const next = { ...overrides };
    delete next[id];
    setOverrides(next);
    setUserKeybindings(next);
    writeUserKeybindings(next);
  };

  const needle = query.trim().toLowerCase();
  const rows = commands
    .filter(
      (command) =>
        !needle ||
        command.title.toLowerCase().includes(needle) ||
        (chords.get(command.id) ?? '').toLowerCase().includes(needle),
    )
    .sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-ink">Shortcuts</h4>
          <p className="text-[11px] text-ink/60 mt-0.5">
            Click a chord to record a new one. Two strokes are allowed; Enter keeps a single stroke.
          </p>
        </div>
        <div className="flex items-center gap-2 px-2.5 py-1.5 border border-ink/15 rounded-md bg-canvas">
          <Search size={13} className="text-ink/40 flex-shrink-0" />
          <input
            type="text"
            value={query}
            onInput={(event) => setQuery(event.currentTarget.value)}
            placeholder="Filter"
            aria-label="Filter shortcuts"
            className="w-32 bg-transparent text-xs text-ink focus:outline-none placeholder-ink/40"
          />
        </div>
      </div>

      {conflicts.length > 0 ? (
        <div className="border border-ink/15 rounded-lg p-3 space-y-1.5 bg-ink/[0.02]">
          <p className="text-[11px] font-semibold text-ink/75">
            {conflicts.length} chord {conflicts.length === 1 ? 'conflict' : 'conflicts'}
          </p>
          {conflicts.map((conflict) => (
            <p key={`${conflict.a.command}-${conflict.b.command}`} className="text-[11px] text-ink/60">
              <span className="font-mono text-ink/80">{formatChord(conflict.chord, isMac)}</span>{' '}
              — {titleOf(conflict.a.command)} and {titleOf(conflict.b.command)}
              {conflict.certain ? '' : ' (may not overlap)'}
            </p>
          ))}
        </div>
      ) : null}

      <div className="bg-paper border border-ink/15 rounded-lg divide-y divide-ink/10 shadow-xs overflow-hidden">
        {rows.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-ink/50">No command matches that filter.</p>
        ) : (
          rows.map((command) => {
            const overridden = overrides[command.id] !== undefined;
            return (
              <div key={command.id} className="px-3 py-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-ink truncate">{command.title}</div>
                  <div className="text-[10px] text-ink/45">
                    {command.category}
                    {command.pluginId ? ` · ${command.pluginId}` : ''}
                    {overridden ? ' · custom' : ''}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <KeyRecorder
                    chord={chords.get(command.id) ?? ''}
                    onCommit={(text) => commit(command.id, text)}
                  />
                  {overridden ? (
                    <button
                      type="button"
                      onClick={() => reset(command.id)}
                      title="Reset to default"
                      aria-label={`Reset ${command.title} to its default shortcut`}
                      className="p-1 rounded text-ink/40 hover:text-ink hover:bg-ink/5 transition-colors"
                    >
                      <RotateCcw size={12} />
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
