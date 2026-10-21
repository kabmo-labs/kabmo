/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The editor column's switcher: files, or one of the plugins that took the
 * column over.
 *
 * The `panel` slot is a TAKEOVER — the plugin draws the whole column, with no tab
 * strip, no file tree and no chrome — so a file tab cannot represent it and the
 * tab strip cannot switch to it. This narrow strip is that switch, and it is why
 * the slot is reachable at all: until it existed the slot was registered and
 * never rendered (`activeEditorPanelKey` was a hard-coded `null`), so a plugin
 * like `session-info` shipped a Scratchpad nobody could open.
 *
 * Two rules:
 *
 * - **Nothing is drawn when no plugin contributes a `panel`.** A rail with one
 *   button would be a control that only ever says "you are already here", so a
 *   Kabmo with no such plugin looks exactly as it did before the slot.
 * - **Files is the first entry and always present**, because the takeover has to
 *   be reversible: without it a plugin that owns the column would leave no way
 *   back to the editor.
 */

import { Files } from 'lucide-preact';
import { PluginMark } from '@/client/components/settings/categories/panel-plugins/PluginMark';
import type { ResolvedPluginPanel } from '@/client/components/workspace/plugin-panel/resolve';

interface EditorPluginRailProps {
  /** The `plugin:<id>` whose panel owns the column, or null for the files view. */
  activeKey: string | null;
  onSelect: (panelKey: string | null) => void;
  plugins: readonly ResolvedPluginPanel[];
}

export function EditorPluginRail({ activeKey, onSelect, plugins }: EditorPluginRailProps) {
  if (plugins.length === 0) return null;

  const entryClass = (active: boolean) =>
    `relative w-full h-9 flex items-center justify-center transition-colors border-l-2 ${
      active ? 'text-ink border-ink bg-ink/5' : 'text-ink/40 border-transparent hover:text-ink hover:bg-ink/5'
    } cursor-pointer`;

  return (
    <nav
      aria-label="Editor panel views"
      className="w-9 flex-shrink-0 border-r border-ink/10 bg-paper flex flex-col items-center py-2 space-y-1 z-10"
    >
      <button
        type="button"
        className={entryClass(activeKey === null)}
        onClick={() => onSelect(null)}
        title="Files"
        aria-label="Files"
        aria-pressed={activeKey === null}
      >
        <Files size={16} />
      </button>
      {plugins.map((plugin) => {
        const active = activeKey === plugin.panelKey;
        return (
          <button
            key={plugin.panelKey}
            type="button"
            className={entryClass(active)}
            onClick={() => onSelect(plugin.panelKey)}
            title={plugin.title}
            aria-label={plugin.title}
            aria-pressed={active}
          >
            <PluginMark name={plugin.name} iconUrl={plugin.iconUrl} size={16} />
          </button>
        );
      })}
    </nav>
  );
}
