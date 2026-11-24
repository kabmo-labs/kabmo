/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The language choice, stated as a decision rather than a text field.
 *
 * Measured on whisper-base (the tier the local engine loads): an Indonesian
 * utterance decoded with `en` — or with no language at all, because the local
 * pipeline defaults to English — came back as English words, and the same
 * utterance decoded with `id` came back correct. The reverse holds too. So the
 * page says which engines can detect, and refuses to imply that "auto" works
 * everywhere.
 */

import { Check } from 'lucide-preact';
import { DICTATION_LANGUAGES, type DictationLanguage } from '@/shared/lib/dictation/languages';
import { dictationEngine } from '@/shared/lib/dictation/engines';
import type { DictationConfig } from '@/shared/lib/dictation/settings';

export interface LanguageSectionProps {
  config: DictationConfig;
  onSelect: (language: DictationLanguage) => void;
}

export function LanguageSection({ config, onSelect }: LanguageSectionProps) {
  const detects = dictationEngine(config.engine).language === 'detect';

  return (
    <section className="space-y-3">
      <div>
        <h4 className="text-sm font-semibold text-ink">Language</h4>
        <p className="mt-0.5 text-[11px] text-ink/60">
          The recognizer is told this language. Picking the wrong one is what turns Indonesian speech
          into English-looking words.
        </p>
      </div>

      <div className="divide-y divide-ink/10 rounded-lg border border-ink/15 bg-paper">
        {DICTATION_LANGUAGES.map((option) => {
          const selected = config.language === option.id;
          const disabled = option.id === 'auto' && !detects;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => onSelect(option.id)}
              className={`flex w-full items-start justify-between gap-3 px-3.5 py-2.5 text-left transition-colors ${
                disabled ? 'cursor-not-allowed opacity-45' : 'hover:bg-ink/[0.03]'
              }`}
            >
              <span className="min-w-0">
                <span className="block text-xs font-medium text-ink">
                  {option.label}
                  {option.tag && <span className="ml-1.5 font-mono text-[10px] text-ink/40">{option.tag}</span>}
                </span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-ink/60">
                  {disabled
                    ? 'The local engine cannot detect a language — a missing hint is English. Pick Indonesian or English.'
                    : option.note}
                </span>
              </span>
              {selected && <Check size={13} className="mt-0.5 shrink-0 text-ink" />}
            </button>
          );
        })}
      </div>
    </section>
  );
}
