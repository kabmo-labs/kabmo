/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * How wide the chat's content column is drawn.
 *
 * Three cards, narrowest to widest, in the order `CHAT_WIDTH_MODES` declares —
 * the row reads as a scale, and the bar inside each card is the same scale drawn
 * to size (60% / 85% / 100% of the track). That bar is why the cards are not
 * just three radio rows: the difference between the modes is a WIDTH, and a
 * label alone cannot show it.
 *
 * The mode changes no panel and no control — it is a reading width. The pixels
 * live in `tailwind.css` (`--chat-column-max`), the names and the copy in
 * `shared/lib/chat/timeline/width-mode.ts`, so this file states neither.
 */

import { Check } from 'lucide-preact';
import type { SettingsState } from '@/shared/types';
import {
  CHAT_WIDTH_MODE_COPY,
  CHAT_WIDTH_MODES,
  type ChatWidthMode,
} from '@/shared/lib/chat/timeline/width-mode';

interface ChatLayoutSectionProps {
  settings: SettingsState;
  onUpdate: (updater: Partial<SettingsState> | ((prev: SettingsState) => SettingsState)) => void;
}

/** The bar's share of the track, per mode. Presentation only — the real
 *  widths are CSS's, and these are chosen so the three are visibly ordered. */
const PREVIEW_SHARE: Record<ChatWidthMode, string> = {
  compact: '60%',
  wide: '85%',
  full: '100%',
};

export function ChatLayoutSection({ settings, onUpdate }: ChatLayoutSectionProps) {
  const selected = settings.chatWidthMode;

  return (
    <section className="space-y-3">
      <div>
        <h4 className="text-sm font-semibold text-ink">Chat Width</h4>
        <p className="text-[11px] text-ink/60 mt-0.5">
          How wide the conversation is drawn. The composer follows the transcript, and no mode hides a panel.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {CHAT_WIDTH_MODES.map((mode) => {
          const copy = CHAT_WIDTH_MODE_COPY[mode];
          const isSelected = selected === mode;
          return (
            <div
              key={mode}
              onClick={() => onUpdate({ chatWidthMode: mode })}
              role="button"
              tabIndex={0}
              aria-pressed={isSelected}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onUpdate({ chatWidthMode: mode });
                }
              }}
              className={`p-3.5 rounded-lg border text-left transition-all cursor-pointer flex flex-col justify-between select-none ${
                isSelected
                  ? 'border-ink bg-ink/5 ring-1 ring-ink/20 shadow-xs'
                  : 'border-ink/15 bg-paper hover:border-ink/30 hover:bg-ink/[0.02]'
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-xs text-ink">{copy.label}</span>
                  <div
                    className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                      isSelected ? 'border-ink bg-ink text-paper' : 'border-ink/30 bg-transparent'
                    }`}
                  >
                    {isSelected && <Check size={10} strokeWidth={3} />}
                  </div>
                </div>

                {/* The width itself, drawn: a track is the chat panel, the bar
                    is the column. */}
                <div aria-hidden className="h-1.5 rounded-full bg-ink/10 mb-2.5 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${isSelected ? 'bg-ink' : 'bg-ink/35'}`}
                    style={{ width: PREVIEW_SHARE[mode] }}
                  />
                </div>

                <p className="text-[11px] text-ink/65 leading-relaxed">{copy.description}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* A phone is narrower than the smallest column, so all three modes draw
          the same thing there. Said in words rather than leaving a control that
          looks inert. */}
      <p className="text-[10px] text-ink/45 font-mono">
        On a phone the column already fills the screen, so the mode has no visible effect.
      </p>
    </section>
  );
}
