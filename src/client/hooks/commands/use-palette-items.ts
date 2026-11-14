/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The palette's rows: commands, editor commands, and files.
 *
 * Commands come from the catalog plus the registry, so a command with no chord
 * is still listed — the old palette derived its rows from the keymap and could
 * only offer what already had a shortcut. Editor commands come from the
 * editor's own table and run through `editor.run`, which is the one adapter
 * between the palette and CodeMirror.
 */

import { useEffect, useMemo, useState } from 'preact/hooks';
import { buildPaletteEntries } from '@/shared/lib/code/editor/palette';
import { evaluateWhen } from '@/shared/lib/commands/when';
import { scoreCommand } from '@/shared/lib/commands/score';
import type { CommandContext, CommandMeta } from '@/shared/lib/commands/types';
import { isMacPlatform } from '@/shared/lib/util/platform';
import { hasCommand, runCommand } from '@/client/lib/commands/registry';
import { useCommandCatalog } from '@/client/hooks/commands/use-command-catalog';
import { pluginContext } from '@/client/lib/plugins/context';
import {
  fetchQuickOpenIndex,
  rankQuickOpen,
  type QuickOpenEntry,
} from '@/client/hooks/editor/quick-open';
import type { PaletteMode } from '@/client/lib/commands/overlays';

export type PaletteItem =
  | {
      kind: 'command';
      id: string;
      title: string;
      category: string;
      chord: string;
      disabled?: string;
      run: () => void;
    }
  | { kind: 'file'; path: string; name: string; directory: string };

export interface PaletteItems {
  items: PaletteItem[];
  loading: boolean;
  error: string | null;
}

function commandItems(
  commands: readonly CommandMeta[],
  chords: Map<string, string>,
  context: CommandContext,
  query: string,
): PaletteItem[] {
  const rows: Array<{ item: PaletteItem; score: number; enabled: boolean }> = [];

  for (const meta of commands) {
    const score = scoreCommand(meta, query);
    if (score === null) continue;
    const available = hasCommand(meta.id);
    const enabled = available && evaluateWhen(meta.when, context);
    rows.push({
      enabled,
      score,
      item: {
        kind: 'command',
        id: meta.id,
        title: meta.title,
        category: meta.category,
        chord: chords.get(meta.id) ?? '',
        ...(enabled ? {} : { disabled: available ? 'Unavailable in this context' : 'Not available' }),
        run: () => runCommand(meta.id),
      },
    });
  }

  const editorAvailable = context.editorPanelVisible === true && hasCommand('editor.run');
  for (const entry of buildPaletteEntries(isMacPlatform())) {
    const score = scoreCommand(
      { id: `editor.${entry.command}`, title: entry.label, category: 'Editor' },
      query,
    );
    if (score === null) continue;
    rows.push({
      enabled: editorAvailable,
      score,
      item: {
        kind: 'command',
        id: `editor.${entry.command}`,
        title: entry.label,
        category: 'Editor',
        chord: entry.chord,
        ...(editorAvailable ? {} : { disabled: 'The editor panel is closed' }),
        run: () => runCommand('editor.run', { command: entry.command }),
      },
    });
  }

  const titleOf = (item: PaletteItem) => (item.kind === 'command' ? item.title : item.name);
  rows.sort(
    (a, b) =>
      Number(b.enabled) - Number(a.enabled) ||
      b.score - a.score ||
      titleOf(a.item).localeCompare(titleOf(b.item)),
  );
  return rows.map((row) => row.item);
}

export function usePaletteItems(
  mode: PaletteMode,
  query: string,
  context: CommandContext,
  active: boolean,
): PaletteItems {
  const { commands, chords } = useCommandCatalog();
  const [files, setFiles] = useState<QuickOpenEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const root = pluginContext().workspacePath;

  // Fetched on every OPEN, not cached for the page: a file the agent just
  // created is exactly the file a picker should find, and the route is a capped
  // walk rather than a full tree read.
  useEffect(() => {
    if (!active || mode !== 'files') return;
    if (!root) {
      setFiles([]);
      setError('No workspace is open');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchQuickOpenIndex(root).then((entries) => {
      if (cancelled) return;
      setFiles(entries);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [active, mode, root]);

  const items = useMemo<PaletteItem[]>(() => {
    if (mode === 'commands') return commandItems(commands, chords, context, query);
    return rankQuickOpen(files, query).map((entry) => ({
      kind: 'file' as const,
      path: entry.path,
      name: entry.name,
      directory: entry.directory,
    }));
  }, [mode, commands, chords, context, query, files]);

  return { items, loading, error };
}
