/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Settings → Appearance → Session sidebar.
 *
 * Two cards, because there are exactly two answers — and the drawing in each is
 * a MINIATURE of the real thing, not an icon: a user choosing a shell for a
 * list they look at all day needs to see the row density and where the controls
 * sit. The miniature is drawn from tokens only (`bg-ink/10`, `text-ink/40`), so
 * it follows the palette like everything else.
 *
 * The cards are `aria-pressed` buttons rather than radios in a form: there is
 * no submit, the choice applies on click, and the settings modal's own
 * `onUpdate` is what persists it. `applySidebarStyle` is called by that path —
 * this file never writes settings itself, so the live apply and the stored copy
 * cannot disagree.
 */

import type { ComponentType } from 'preact/compat';
import type { SettingsState } from '@/shared/types';
import {
  SIDEBAR_STYLES,
  SIDEBAR_STYLE_COPY,
  resolveSidebarStyle,
  type SidebarStyle,
} from '@/shared/lib/workspace/sidebar-style';

interface SidebarStyleSectionProps {
  settings: SettingsState;
  onUpdate: (updater: Partial<SettingsState> | ((previous: SettingsState) => SettingsState)) => void;
}

/** A row in the miniature: the leading slot, a title bar, optional trailing. */
function MiniRow({ width, active = false, trailing = false }: { width: number; active?: boolean; trailing?: boolean }) {
  return (
    <span className="flex h-[9px] items-center gap-1 px-1">
      <span className={`h-[5px] w-[5px] shrink-0 rounded-full ${active ? 'bg-ink' : 'bg-ink/25'}`} />
      <span
        className={`h-[3px] rounded-full ${active ? 'bg-ink/70' : 'bg-ink/25'}`}
        style={{ width: `${width}%` }}
      />
      {trailing && <span className="ml-auto h-[3px] w-[6px] rounded-full bg-ink/20" />}
    </span>
  );
}

/**
 * The classic frame: a toolbar of boxed controls over compact rows.
 */
function ClassicMiniature() {
  return (
    <span className="flex h-full flex-col gap-1 rounded-md border border-ink/10 bg-paper p-1" aria-hidden="true">
      <span className="flex items-center gap-0.5">
        <span className="h-[7px] w-[30%] rounded-sm bg-ink/80" />
        <span className="h-[7px] w-[7px] rounded-sm border border-ink/20 bg-paper" />
        <span className="h-[7px] w-[7px] rounded-sm border border-ink/20 bg-paper" />
        <span className="ml-auto h-[7px] w-[7px] rounded-sm border border-ink/20 bg-paper" />
        <span className="h-[7px] w-[7px] rounded-sm border border-ink/20 bg-paper" />
      </span>
      <span className="flex h-[7px] items-center gap-1 px-1">
        <span className="h-[3px] w-[45%] rounded-full bg-ink/45" />
      </span>
      <MiniRow width={62} trailing />
      <MiniRow width={50} active trailing />
      <MiniRow width={44} trailing />
      <MiniRow width={56} trailing />
    </span>
  );
}

/**
 * The modern frame: a permanent search line, filter chips, a workspace header
 * and taller rows with one trailing column.
 */
function ModernMiniature() {
  return (
    <span className="flex h-full flex-col gap-1 rounded-md border border-ink/10 bg-paper p-1" aria-hidden="true">
      <span className="flex h-[7px] items-center rounded-sm bg-ink/5 px-1">
        <span className="h-[3px] w-[38%] rounded-full bg-ink/30" />
      </span>
      <span className="flex items-center gap-0.5">
        <span className="h-[6px] w-[16%] rounded-full bg-ink/80" />
        <span className="h-[6px] w-[22%] rounded-full border border-ink/20" />
        <span className="h-[6px] w-[12%] rounded-full border border-ink/20" />
      </span>
      <span className="flex h-[9px] items-center gap-1 px-1">
        <span className="h-[5px] w-[5px] shrink-0 rounded-full bg-ink/50" />
        <span className="h-[3px] w-[40%] rounded-full bg-ink/45" />
        <span className="ml-auto h-[3px] w-[5px] rounded-full bg-ink/20" />
      </span>
      <MiniRow width={62} active trailing />
      <MiniRow width={50} trailing />
      <MiniRow width={44} trailing />
    </span>
  );
}

const MINIATURES: Record<SidebarStyle, ComponentType> = {
  classic: ClassicMiniature,
  modern: ModernMiniature,
};

export function SidebarStyleSection({ settings, onUpdate }: SidebarStyleSectionProps) {
  const selected = resolveSidebarStyle(settings.sidebarStyle);

  return (
    <section className="space-y-3">
      <div>
        <h4 className="text-xs font-semibold text-ink">Session sidebar</h4>
        <p className="mt-0.5 text-[11px] text-ink/50">
          How the left column draws its workspaces and chats. Both styles list the same
          workspaces and offer the same actions; the choice applies to desktop and phone,
          and takes effect immediately.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2" role="group" aria-label="Session sidebar style">
        {SIDEBAR_STYLES.map((style) => {
          const copy = SIDEBAR_STYLE_COPY[style];
          const isSelected = style === selected;
          const Miniature = MINIATURES[style];
          return (
            <button
              key={style}
              type="button"
              onClick={() => onUpdate({ sidebarStyle: style })}
              aria-pressed={isSelected}
              aria-label={`${copy.label} sidebar — ${copy.description}`}
              className={`flex flex-col gap-2 rounded-xl border p-2.5 text-left transition-colors cursor-pointer ${
                isSelected
                  ? 'border-ink/40 bg-ink/5'
                  : 'border-ink/15 bg-paper hover:border-ink/30 hover:bg-ink/5'
              }`}
            >
              <span className="block h-[86px]">
                <Miniature />
              </span>
              <span className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-ink">{copy.label}</span>
                <span className="font-mono text-[10px] text-ink/40">{copy.caption}</span>
                {isSelected && (
                  <span className="ml-auto rounded-full bg-ink px-1.5 py-[1px] text-[9px] font-semibold text-paper">
                    active
                  </span>
                )}
              </span>
              <span className="text-[11px] leading-relaxed text-ink/60">{copy.description}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
