/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { useMemo } from 'preact/hooks';
import { useSyncExternalStore } from 'preact/compat';
import { ttsPlayer } from '@/client/lib/tts/player';
import type { TtsConfig } from '@/shared/lib/tts/settings';
import type { TtsHandle } from '@/client/hooks/tts/tts-context';

/** Stable identities: the autoplay effect depends on these, not on a snapshot. */
export function speakTts(text: string, key: string, config?: TtsConfig): void {
  ttsPlayer.speak(text, key, config);
}

export function stopTts(): void {
  ttsPlayer.stop();
}

/** Subscribe one component to the player's snapshot. */
export function useTtsPlayer(): TtsHandle {
  const snapshot = useSyncExternalStore(ttsPlayer.subscribe, ttsPlayer.getSnapshot);

  return useMemo<TtsHandle>(() => ({
    enabled: true,
    status: snapshot.status,
    activeKey: snapshot.activeKey,
    error: snapshot.error,
    speak: speakTts,
    stop: stopTts,
  }), [snapshot]);
}
