/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The shortcut sheet: every chord this build answers to, grouped by area.
 *
 * It reads the SAME tables the dispatcher reads — the catalog, the effective
 * keymap and the editor's keymap — so a chord shown here is a chord that works.
 * A hand-written cheat sheet is the classic drift: it names `⌘B` long after the
 * binding moved.
 */

import { useMemo, useState } from 'preact/hooks';
import { Search } from 'lucide-preact';
import { Modal } from '@/client/components/common/Modal';
import { buildPaletteEntries } from '@/shared/lib/code/editor/palette';
import { isMacPlatform } from '@/shared/lib/util/platform';
import { useCommandCatalog } from '@/client/hooks/commands/use-command-catalog';

interface ShortcutRow {
  id: string;
  title: string;
  chord: string;
  overridden: boolean;
}

interface ShortcutGroup {
  label: string;
  rows: ShortcutRow[];
}

function buildGroups(
  commands: ReturnType<typeof useCommandCatalog>['commands'],
  chords: Map<string, string>,
  overrides: Record<string, string | null>,
): ShortcutGroup[] {
  const isMac = isMacPlatform();
  const byCategory = new Map<string, ShortcutRow[]>();
  for (const command of commands) {
    const rows = byCategory.get(command.category) ?? [];
    rows.push({
      id: command.id,
      title: command.title,
      chord: chords.get(command.id) ?? '—',
      overridden: overrides[command.id] !== undefined,
    });
    byCategory.set(command.category, rows);
  }

  const groups: ShortcutGroup[] = [...byCategory.entries()].map(([label, rows]) => ({
    label,
    rows: rows.sort((a, b) => a.title.localeCompare(b.title)),
  }));

  groups.push({
    label: 'Editor (text)',
    rows: buildPaletteEntries(isMac).map((entry) => ({
      id: `editor.${entry.command}`,
      title: entry.label,
      chord: entry.chord,
      overridden: false,
    })),
  });

  return groups;
}

export function KeyBindingCheatsheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const catalog = useCommandCatalog();
  const groups = useMemo(
    () => buildGroups(catalog.commands, catalog.chords, catalog.overrides),
    [catalog.commands, catalog.chords, catalog.overrides],
  );

  if (!open) return null;

  const needle = query.trim().toLowerCase();
  const filtered = groups
    .map((group) => ({
      label: group.label,
      rows: group.rows.filter(
        (row) =>
          !needle ||
          row.title.toLowerCase().includes(needle) ||
          row.chord.toLowerCase().includes(needle),
      ),
    }))
    .filter((group) => group.rows.length > 0);

  return (
    <Modal
      onClose={onClose}
      ariaLabel="Keyboard shortcuts"
      maxWidthClass="max-w-2xl"
      header={
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold text-sm text-ink">Keyboard Shortcuts</span>
          <span className="text-[10px] text-ink/40 font-mono">⌘K ⌘S</span>
        </div>
      }
    >
      <div className="px-4 pt-3">
        <div className="flex items-center gap-2 px-2.5 py-1.5 border border-ink/15 rounded-md bg-canvas">
          <Search size={13} className="text-ink/40 flex-shrink-0" />
          <input
            type="text"
            value={query}
            onInput={(event) => setQuery(event.currentTarget.value)}
            placeholder="Filter by command or chord"
            aria-label="Filter shortcuts"
            className="flex-1 min-w-0 bg-transparent text-xs text-ink focus:outline-none placeholder-ink/40"
          />
        </div>
      </div>

      <div className="px-4 py-3 max-h-[60vh] overflow-y-auto space-y-4">
        {filtered.length === 0 ? (
          <p className="text-xs text-ink/50 text-center py-6">No shortcut matches that filter.</p>
        ) : (
          filtered.map((group) => (
            <section key={group.label}>
              <h4 className="text-[10px] font-semibold uppercase tracking-wide text-ink/45 mb-1.5">
                {group.label}
              </h4>
              <div className="border border-ink/10 rounded-lg divide-y divide-ink/10 overflow-hidden">
                {group.rows.map((row) => (
                  <div key={row.id} className="flex items-center justify-between gap-3 px-3 py-1.5">
                    <span className="text-xs text-ink/80 truncate">
                      {row.title}
                      {row.overridden ? (
                        <span className="ml-1.5 text-[9px] text-ink/40 font-mono">custom</span>
                      ) : null}
                    </span>
                    <span className="font-mono text-[10px] text-ink/55 flex-shrink-0">{row.chord}</span>
                  </div>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </Modal>
  );
}
