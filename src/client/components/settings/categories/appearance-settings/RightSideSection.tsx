/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Settings → Appearance → Right side.
 *
 * The navbar's toggle puts the editor column, the right panel and their rail
 * away. How long that lasts is the reader's choice, and `session` is the
 * default: a layout choice belongs to the chat it was made in, exactly like the
 * two columns' own switches. `global` is for the reader who works the same way
 * in every chat — the toggle then answers for the screen instead.
 *
 * The cards are `aria-pressed` buttons rather than radios: there is no submit,
 * the choice applies on click, and a second click on the active card must not
 * flip the side.
 */

import type { SettingsState } from '@/shared/types';
import {
  resolveRightSideHiddenScope,
  type RightSideHiddenScope,
} from '@/shared/lib/workspace/right-side-hidden';

interface RightSideSectionProps {
  settings: SettingsState;
  onUpdate: (updater: Partial<SettingsState> | ((previous: SettingsState) => SettingsState)) => void;
}

const SCOPES: readonly RightSideHiddenScope[] = ['session', 'global'];

const COPY: Record<RightSideHiddenScope, { label: string; caption: string; description: string }> = {
  session: {
    label: 'Per chat',
    caption: 'default',
    description:
      'Closing the side belongs to the chat you closed it in. Every other chat keeps the layout it was left with.',
  },
  global: {
    label: 'All chats',
    caption: 'global',
    description:
      'Closing the side applies to every chat. Opening it once brings it back everywhere, whichever chat is open.',
  },
};

export function RightSideSection({ settings, onUpdate }: RightSideSectionProps) {
  const scope = resolveRightSideHiddenScope(settings.rightSideHiddenScope);

  return (
    <section className="space-y-3">
      <div>
        <h4 className="text-sm font-semibold text-ink">Right side</h4>
        <p className="mt-0.5 text-[11px] text-ink/60">
          How long the navbar’s right-side button is remembered: the side you closed in one chat, or
          the side every chat opens with.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2" role="group" aria-label="Right side toggle">
        {SCOPES.map((id) => {
          const copy = COPY[id];
          const isSelected = id === scope;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onUpdate({ rightSideHiddenScope: id })}
              aria-pressed={isSelected}
              aria-label={`${copy.label} — ${copy.description}`}
              className={`flex flex-col gap-2 rounded-xl border p-2.5 text-left transition-colors cursor-pointer ${
                isSelected
                  ? 'border-ink/40 bg-ink/5'
                  : 'border-ink/15 bg-paper hover:border-ink/30 hover:bg-ink/5'
              }`}
            >
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
