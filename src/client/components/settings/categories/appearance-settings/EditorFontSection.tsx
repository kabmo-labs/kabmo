/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { Check, Type } from 'lucide-preact';
import type { SettingsState } from '@/shared/types';
import { EDITOR_FONT_CHOICES } from '@/shared/lib/code/editor/typography';

interface EditorFontSectionProps {
  settings: SettingsState;
  onUpdate: (updater: Partial<SettingsState> | ((prev: SettingsState) => SettingsState)) => void;
}

/**
 * The code editor's typeface.
 *
 * Only Fira Code is bundled, so each row states whether the face ships with the
 * app or has to come from the device. That is the difference between a choice
 * that always works and one that silently falls back — and the fallback is
 * visible in the row's own preview, which is set in the face it names.
 */
export function EditorFontSection({ settings, onUpdate }: EditorFontSectionProps) {
  const active = settings.editorFont || EDITOR_FONT_CHOICES[0].id;

  return (
    <section className="space-y-3">
      <div>
        <h3 className="font-semibold text-sm uppercase tracking-wider text-ink/80 flex items-center gap-2">
          <Type size={16} className="text-ink/60" />
          Editor Font
        </h3>
        <p className="text-[11px] text-ink/60 mt-1">
          Typeface for the code editor and its line numbers, in both the desktop panel and the phone's
          full-screen editor. Only Fira Code ships with the app; the others are used when your device
          has them, and fall back to Fira Code when it does not.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {EDITOR_FONT_CHOICES.map((choice) => {
          const selected = active === choice.id;
          return (
            <button
              key={choice.id}
              type="button"
              onClick={() => onUpdate({ editorFont: choice.id })}
              aria-pressed={selected}
              className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                selected ? 'border-ink/40 bg-ink/5' : 'border-ink/12 hover:bg-ink/5'
              }`}
            >
              <span className="min-w-0">
                {/* Preview in the face it names: an uninstalled choice shows its
                    own fallback here rather than after the user commits to it. */}
                <span
                  className="block truncate text-xs text-ink"
                  style={{ fontFamily: `"${choice.id}", monospace` }}
                >
                  const greet = () =&gt; 'hi'
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-ink/50">
                  <span>{choice.label}</span>
                  {choice.bundled && (
                    <span className="rounded bg-ink/8 px-1 py-px text-[9px] uppercase tracking-wide">
                      Bundled
                    </span>
                  )}
                </span>
              </span>
              {selected && <Check size={14} className="text-ink flex-shrink-0" />}
            </button>
          );
        })}
      </div>
    </section>
  );
}
