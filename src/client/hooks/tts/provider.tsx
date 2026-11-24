/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Mounts the speech player for one chat surface: the context the footer buttons
 * read, the autoplay trigger, and one toast per failure.
 *
 * It wraps only the timeline, not the whole app. A session that settles while
 * its chat is not on screen should not start talking from a settings dialog;
 * the button follows the run, and the run is what this provider is mounted for.
 */

import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { useToasts } from '@/client/hooks/ui/toasts';
import { stopTts, useTtsPlayer } from '@/client/hooks/tts/use-tts-player';
import { useSpeechAutoplay } from '@/client/hooks/tts/use-speech-autoplay';
import { TtsContext } from '@/client/hooks/tts/tts-context';
import type { ChatMessageData } from '@/shared/types';

interface TtsProviderProps {
  messages: ChatMessageData[];
  isGenerating: boolean;
  sessionId?: string | null;
  children: ComponentChildren;
}

export function TtsProvider({ messages, isGenerating, sessionId, children }: TtsProviderProps) {
  const handle = useTtsPlayer();
  const { pushToast } = useToasts();
  const lastError = useRef<string | null>(null);

  useSpeechAutoplay({ messages, isGenerating, sessionId });

  // Leaving the chat stops the answer it was reading: the audio belongs to the
  // surface that started it, not to the tab.
  useEffect(() => () => stopTts(), []);

  useEffect(() => {
    if (handle.error && handle.error !== lastError.current) {
      lastError.current = handle.error;
      pushToast(handle.error, 'error', { duration: 6000 });
    }
    if (!handle.error) lastError.current = null;
  }, [handle.error, pushToast]);

  return <TtsContext.Provider value={handle}>{children}</TtsContext.Provider>;
}
