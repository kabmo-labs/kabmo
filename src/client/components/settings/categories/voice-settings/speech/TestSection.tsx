/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Speaks one fixed sentence with the settings currently on screen — before they
 * are saved, and before the user trusts them with a real answer.
 *
 * The sample goes through the same route and player as a real answer, so a key
 * that is wrong, a voice id that no longer exists and an endpoint that cannot be
 * reached all fail here with the provider's own sentence.
 */

import { Loader2, Play, Square } from 'lucide-preact';
import { useTtsPlayer } from '@/client/hooks/tts/use-tts-player';
import type { TtsConfig } from '@/shared/lib/tts/settings';

const SAMPLE = 'This is how Kabmo will read your answers aloud.';
const TEST_KEY = 'settings-test';

export interface SpeechTestSectionProps {
  config: TtsConfig;
}

export function SpeechTestSection({ config }: SpeechTestSectionProps) {
  const tts = useTtsPlayer();
  const testing = tts.activeKey === TEST_KEY && (tts.status === 'loading' || tts.status === 'playing');

  return (
    <section className="space-y-3">
      <div>
        <h4 className="text-sm font-semibold text-ink">Test</h4>
        <p className="mt-0.5 text-[11px] text-ink/60">
          Speaks one sentence with the settings above, even before they are saved.
        </p>
      </div>

      <button
        type="button"
        onClick={() => {
          if (testing) tts.stop();
          else tts.speak(SAMPLE, TEST_KEY, config);
        }}
        className="inline-flex items-center gap-2 rounded-md border border-ink/20 px-3 py-2 text-[12px] text-ink transition-colors hover:border-ink/40 hover:bg-ink/5"
      >
        {testing
          ? (tts.status === 'loading'
              ? <Loader2 size={14} className="animate-spin" />
              : <Square size={13} />)
          : <Play size={14} />}
        {testing ? 'Stop' : 'Test voice'}
      </button>
    </section>
  );
}
