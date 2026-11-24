/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Whether a finished run starts speaking by itself.
 *
 * Default OFF on purpose: unexpected audio is hostile, and every hosted engine
 * bills per character. The note names the browser's own rule too — playback is
 * allowed only after the page has been interacted with, so the first automatic
 * read may still need one click.
 */

import type { TtsConfig } from '@/shared/lib/tts/settings';
import { CHECKBOX_CLASS } from '@/client/components/common/checkbox/style';

export interface SpeechAutoplaySectionProps {
  config: TtsConfig;
  onPatch: (patch: Partial<TtsConfig>) => void;
}

export function SpeechAutoplaySection({ config, onPatch }: SpeechAutoplaySectionProps) {
  return (
    <section className="space-y-3">
      <div>
        <h4 className="text-sm font-semibold text-ink">Autoplay</h4>
        <p className="mt-0.5 text-[11px] text-ink/60">What happens when a run finishes.</p>
      </div>

      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-ink/15 bg-paper px-3.5 py-3">
        <input
          type="checkbox"
          checked={config.autoplay}
          onChange={(event) => onPatch({ autoplay: event.currentTarget.checked })}
          className={`${CHECKBOX_CLASS} mt-0.5 h-4 w-4 cursor-pointer accent-ink`}
        />
        <span className="min-w-0 space-y-1">
          <span className="block text-[12px] font-medium text-ink">Read the final answer aloud</span>
          <span className="block text-[11px] leading-relaxed text-ink/60">
            A run that finishes while this chat is open is read once. History loaded on mount is
            not replayed. Browsers block audio until you have interacted with the page, so the very
            first automatic read may need one click on the speaker button.
          </span>
        </span>
      </label>
    </section>
  );
}
