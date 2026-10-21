/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The phone's panel tab strip — ONE component, drawn by both drawers.
 *
 * A phone has no rail: the desktop's vertical activity bar is a horizontal
 * strip of chips here. The right drawer had this from the start and the left
 * drawer (the session list) did not, so a plugin panel placed on the left was
 * reachable only through the RIGHT drawer's `all` catalog — the placement
 * existed and nothing on the left ever showed it.
 *
 * Both drawers render this, so the two cannot drift in label, active state or
 * the Source Control dot. The strip is scrollable rather than wrapping: a phone
 * drawer is one row tall, and a wrapped strip would eat the list's height.
 */

import type { ResolvedPanel } from '@/client/components/workspace/plugin-panel/catalog';
import { PluginMark } from '@/client/components/settings/categories/panel-plugins/PluginMark';
import { PANEL_MARK_SIZE } from '@/shared/lib/workspace/right-panels';

interface PanelChipsProps {
  panels: readonly ResolvedPanel[];
  activeId: string;
  onSelect: (id: string) => void;
  /**
   * Draw the Source Control dot on the `git` chip. The left catalog never holds
   * a built-in view, so only the right drawer passes this.
   */
  hasGitChanges?: boolean;
}

export function PanelChips({ panels, activeId, onSelect, hasGitChanges = false }: PanelChipsProps) {
  return (
    <div className="flex items-center space-x-1.5 overflow-x-auto no-scrollbar py-1">
      {panels.map((panel) => {
        const active = panel.id === activeId;
        return (
          <button
            key={panel.id}
            type="button"
            onClick={() => onSelect(panel.id)}
            aria-pressed={active}
            // The name is the panel's TITLE, never its visible label. The label
            // only renders while the chip is active, so without this the same
            // button is called "Resources — stats" before a click and
            // "Resources" after it — a control that renames itself when used is
            // unusable to a screen reader and unfindable to a spec.
            aria-label={panel.title}
            className={`relative flex items-center transition-all cursor-pointer ${
              active
                ? 'space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-ink text-canvas shadow-sm'
                : 'p-2 rounded-lg text-ink/70 hover:bg-ink/5'
            }`}
            title={panel.title}
          >
            {panel.builtin ? panel.icon : <PluginMark name={panel.name} iconUrl={panel.iconUrl} size={PANEL_MARK_SIZE} />}
            {active && (
              <span className={panel.id === 'git' ? 'tracking-wide' : undefined}>{panel.label}</span>
            )}
            {panel.id === 'git' && hasGitChanges && (
              <span
                className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-info"
                title="Uncommitted changes"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
