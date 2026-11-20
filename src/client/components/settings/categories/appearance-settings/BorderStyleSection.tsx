/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Settings → Appearance → Rules.
 *
 * Two cards, each a MINIATURE of the same panel drawn twice: the only thing this
 * setting decides is whether the 1px rules between rows and columns are painted,
 * so the card has to show exactly that — the same header, the same rows, the
 * same column split, once ruled and once not.
 *
 * The miniature is built from the product's own tokens (`bg-paper`, `bg-ink/NN`,
 * `border-ink/NN`), never from a hex, so a card cannot promise a look the shell
 * does not ship.
 *
 * The cards are `aria-pressed` buttons rather than radios: there is no submit,
 * the choice applies on click, and `applySettingsSideEffects` is what writes the
 * document attribute — this file never touches the DOM itself, so the live apply
 * and the persisted copy cannot disagree.
 */

import type { ComponentType } from 'preact/compat';
import type { SettingsState } from '@/shared/types';
import {
  BORDER_STYLES,
  BORDER_STYLE_COPY,
  resolveBorderStyle,
  type BorderStyle,
} from '@/shared/lib/theme/border-style';

interface BorderStyleSectionProps {
  settings: SettingsState;
  onUpdate: (updater: Partial<SettingsState> | ((previous: SettingsState) => SettingsState)) => void;
}

/** The content both miniatures share, so the ONLY difference is the rules. */
function MiniRows({ ruled }: { ruled: boolean }) {
  const rowRule = ruled ? 'border-b border-ink/10' : '';
  return (
    <span className="flex h-full flex-col">
      {[0, 1, 2].map((row) => (
        <span key={row} className={`flex items-center gap-1 px-1 py-[3px] ${rowRule}`}>
          <span className="h-[3px] w-[26%] rounded-full bg-ink/35" />
          <span className="h-[3px] w-[14%] rounded-full bg-ink/15" />
        </span>
      ))}
    </span>
  );
}

/**
 * A panel split into a side column and a body, which is where the app's hairlines
 * actually live: a `border-r` beside the column and a `border-b` under the
 * header. Both are drawn at the SAME alpha the product uses (`ink/10`), so the
 * ruled card is a fair sample rather than a heavier illustration.
 */
function Frame({ ruled }: { ruled: boolean }) {
  return (
    <span className="flex h-full overflow-hidden rounded-md border border-ink/15 bg-paper" aria-hidden="true">
      <span className={`flex w-[34%] flex-col gap-1 p-1 ${ruled ? 'border-r border-ink/10' : ''}`}>
        <span className="h-[3px] w-[70%] rounded-full bg-ink/35" />
        <span className="h-[3px] w-[52%] rounded-full bg-ink/20" />
        <span className="h-[3px] w-[62%] rounded-full bg-ink/20" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={`flex h-[12px] flex-shrink-0 items-center px-1 ${ruled ? 'border-b border-ink/10' : ''}`}
        >
          <span className="h-[3px] w-[40%] rounded-full bg-ink/30" />
        </span>
        <MiniRows ruled={ruled} />
      </span>
    </span>
  );
}

const MINIATURES: Record<BorderStyle, ComponentType> = {
  hairline: () => <Frame ruled />,
  borderless: () => <Frame ruled={false} />,
};

export function BorderStyleSection({ settings, onUpdate }: BorderStyleSectionProps) {
  const selected = resolveBorderStyle(settings.borderStyle);

  return (
    <section className="space-y-3">
      <div>
        <h4 className="text-sm font-semibold text-ink">Rules</h4>
        <p className="mt-0.5 text-[11px] text-ink/60">
          Whether the 1px rules between panels, columns and rows are painted. Controls keep their
          edge either way, and so do validation colours, drop zones and the focus ring.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2" role="group" aria-label="Border style">
        {BORDER_STYLES.map((style) => {
          const copy = BORDER_STYLE_COPY[style];
          const isSelected = style === selected;
          const Miniature = MINIATURES[style];
          return (
            <button
              key={style}
              type="button"
              onClick={() => onUpdate({ borderStyle: style })}
              aria-pressed={isSelected}
              aria-label={`${copy.label} rules — ${copy.description}`}
              className={`flex flex-col gap-2 rounded-xl border p-2.5 text-left transition-colors cursor-pointer ${
                isSelected
                  ? 'border-ink/40 bg-ink/5'
                  : 'border-ink/15 bg-paper hover:border-ink/30 hover:bg-ink/5'
              }`}
            >
              <span className="block h-[62px]">
                <Miniature />
              </span>
              <span className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-ink">{copy.label}</span>
                <span className="font-mono text-[10px] text-ink/40">{copy.caption}</span>
                {isSelected && (
                  <span className="ml-auto rounded-full bg-ink px-1.5 py-[1px] text-[10px] font-semibold text-paper">
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
