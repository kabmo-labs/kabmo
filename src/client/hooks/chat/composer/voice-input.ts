/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Composer-facing wrapper over dictation: owns the toggle, the transient error
 * notice, and the status line the composer shows while a first-run model
 * download is still in flight.
 *
 * It deliberately does NOT write into the textarea. omp's STT is not
 * incremental, so there is no live transcript to show while recording — the
 * text appears once, when the utterance is transcribed.
 */

import { useEffect, useState } from 'preact/hooks';
import { useSpeechToText } from '@/client/hooks/chat/composer/speech-to-text';

export interface UseVoiceInputReturn {
  /** Whether the browser can capture audio. */
  voiceSupported: boolean;
  /** True while the microphone is open. */
  voiceListening: boolean;
  /** True from release until the transcript arrives. */
  voiceBusy: boolean;
  /** Status line while busy ("Downloading speech model 42%"). */
  voiceStatus: string | null;
  /** Toggle recording on/off. The mic button's `onClick`. */
  handleVoiceToggle: () => void;
  /** Non-null while a dictation error should be shown. Clears after 6 s. */
  displayedVoiceError: string | null;
}

export function useVoiceInput(onResult: (text: string) => void): UseVoiceInputReturn {
  const {
    isSupported: voiceSupported,
    isListening: voiceListening,
    isTranscribing: voiceBusy,
    progressText,
    startListening,
    stopListening,
    error: voiceError,
  } = useSpeechToText({ onResult });

  const handleVoiceToggle = () => {
    if (voiceListening) {
      stopListening();
    } else if (!voiceBusy) {
      startListening();
    }
  };

  // A download failure or a refused microphone can be long-winded ("Check
  // proxy/firewall settings"); give the reader time to finish it.
  const [displayedVoiceError, setDisplayedVoiceError] = useState<string | null>(null);
  useEffect(() => {
    if (!voiceError) return;
    setDisplayedVoiceError(voiceError);
    const timer = setTimeout(() => setDisplayedVoiceError(null), 6000);
    return () => clearTimeout(timer);
  }, [voiceError]);

  return {
    voiceSupported,
    voiceListening,
    voiceBusy,
    voiceStatus: voiceBusy ? progressText : null,
    handleVoiceToggle,
    displayedVoiceError,
  };
}
