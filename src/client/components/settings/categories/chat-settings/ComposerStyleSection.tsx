/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Settings → Chats → Composer.
 *
 * Four cards, because there are exactly four answers, and the drawing in each
 * is a MINIATURE of the real card — same row order, same trailing controls —
 * rather than an icon. A user choosing the shape of the thing they type into
 * all day needs to see where the draft sits relative to the controls; a label
 * alone cannot show that.
 *
 * The miniature is DRAWN FROM THE SAME TABLE the composer renders from
 * (`composerStyleLayout().wire`), so a style whose order changes cannot leave
 * its picture behind. Tokens only (`bg-ink/10`, `border-ink/15`), so it follows
 * the palette like everything else.
 *
 * The cards are `aria-pressed` buttons rather than radios: there is no submit,
 * the choice applies on click, and the modal's own `onUpdate` persists it and
 * runs the side effects. This file never writes settings itself.
 */

import type { SettingsState } from '@/shared/types';
import {
  COMPOSER_STYLES,
  COMPOSER_STYLE_COPY,
  composerStyleLayout,
  resolveComposerStyle,
  type ComposerStyle,
} from '@/shared/lib/chat/composer/style';

interface ComposerStyleSectionProps {
  settings: SettingsState;
  onUpdate: (updater: Partial<SettingsState> | ((previous: SettingsState) => SettingsState)) => void;
}

/** One chip in the miniature: an attachment/file pill. */
function MiniChip({ active = false }: { active?: boolean }) {
  return (
    <span className={`h-[6px] w-[16px] rounded-sm border ${active ? 'border-ink/40 bg-ink/15' : 'border-ink/20 bg-ink/5'}`} />
  );
}

/**
 * The draft bar in the miniature: three text lines, the last one short, so it
 * reads as a text box rather than a divider.
 */
function MiniDraft({ hero = false }: { hero?: boolean }) {
  return (
    <span className={`flex flex-col gap-[3px] rounded-md border border-ink/15 bg-paper px-1.5 py-1 ${hero ? 'flex-1 justify-center' : ''}`}>
      <span className="h-[2.5px] w-[72%] rounded-full bg-ink/25" />
      <span className="h-[2.5px] w-[54%] rounded-full bg-ink/20" />
      <span className="h-[2.5px] w-[30%] rounded-full bg-ink/15" />
    </span>
  );
}

/**
 * The trailing control row in the miniature: the model pill, the mode toggles
 * and the send button, in the order the real toolbar draws them.
 */
function MiniControls({ rail = false }: { rail?: boolean }) {
  if (rail) {
    return (
      <span className="flex items-center gap-1 border-t border-ink/10 px-1 pt-1 font-mono">
        <span className="h-[2.5px] w-[14px] rounded-full bg-ink/30" />
        <span className="h-[2.5px] w-[9px] rounded-full bg-ink/20" />
        <span className="h-[2.5px] w-[11px] rounded-full bg-ink/20" />
        <span className="ml-auto h-[7px] w-[7px] rounded-sm bg-ink/80" />
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 px-1">
      <span className="h-[6px] w-[20px] rounded-sm bg-ink/15" />
      <span className="h-[6px] w-[10px] rounded-sm bg-ink/10" />
      <span className="ml-auto h-[7px] w-[7px] rounded-full border border-ink/25" />
      <span className="h-[7px] w-[7px] rounded-sm bg-ink/80" />
    </span>
  );
}

/**
 * The frame each style draws in the settings card. A table rather than a
 * ternary chain: the composer's own frame is CSS keyed by
 * `[data-composer-style]`, and this is its miniature — the two are separate
 * facts, but neither may be missing a style.
 */
const MINIATURE_FRAME: Record<ComposerStyle, string> = {
  classic: 'rounded-md bg-paper border-ink/10',
  calm: 'rounded-lg bg-paper border-ink/10',
  console: 'rounded-sm bg-paper border-ink/10',
  stage: 'rounded-md bg-paper border-ink/15',
  // The glass card is translucent in the product; drawn small it needs an
  // OPAQUE hint instead, because there is nothing behind it to show through.
  glass: 'rounded-xl border-ink/15 bg-gradient-to-b from-ink/[0.06] to-transparent',
};

/**
 * The card, drawn from the style's own row order. `wire` is the same list the
 * renderer loops over, so this picture cannot disagree with the product.
 */
function Miniature({ style }: { style: ComposerStyle }) {
  const layout = composerStyleLayout({ style, hero: style === 'stage' });
  return (
    <span
      className={`flex h-full flex-col gap-1 border p-1 ${MINIATURE_FRAME[style]}`}
      aria-hidden="true"
    >
      {layout.wire.map((row, index) =>
        row === 'draft' ? (
          <MiniDraft key={index} hero={style === 'stage'} />
        ) : row === 'chip' ? (
          <span key={index} className="flex items-center gap-1 px-1">
            <MiniChip active={style !== 'calm'} />
            <MiniChip />
          </span>
        ) : (
          <MiniControls key={index} rail={layout.toolbarTone === 'rail'} />
        ),
      )}
    </span>
  );
}

export function ComposerStyleSection({ settings, onUpdate }: ComposerStyleSectionProps) {
  const selected = resolveComposerStyle(settings.composerStyle);

  return (
    <section className="space-y-3">
      <div>
        <h4 className="text-sm font-semibold text-ink">Composer</h4>
        <p className="mt-0.5 text-[11px] text-ink/60">
          The shape of the box you type into. Every style offers the same controls — attachments,
          plan and goal, access mode, model, thinking, voice, send — and only their order and frame
          change. Applies to desktop and phone, and takes effect immediately.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="group" aria-label="Composer style">
        {COMPOSER_STYLES.map((style) => {
          const copy = COMPOSER_STYLE_COPY[style];
          const isSelected = style === selected;
          return (
            <button
              key={style}
              type="button"
              onClick={() => onUpdate({ composerStyle: style })}
              aria-pressed={isSelected}
              aria-label={`${copy.label} composer — ${copy.description}`}
              className={`flex flex-col gap-2 rounded-xl border p-2.5 text-left transition-colors cursor-pointer ${
                isSelected
                  ? 'border-ink/40 bg-ink/5'
                  : 'border-ink/15 bg-paper hover:border-ink/30 hover:bg-ink/5'
              }`}
            >
              <span className="block h-[92px]">
                <Miniature style={style} />
              </span>
              <span className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-ink">{copy.label}</span>
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
