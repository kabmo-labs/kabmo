/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Composer-facing wrapper over dictation: owns the toggle, the transient error
 * notice, and the status line the composer shows while a first-run model
 * download is still in flight.
 *
 * It deliberately does NOT write into the textarea. No engine streams here —
 * omp's is not incremental, and the hosted ones return one transcript per
 * request — so the text appears once, when the utterance is transcribed.
 *
 * The preference comes from `useDictationConfig`, which is live: the settings
 * modal announces an edit and the next utterance uses it, without a reload.
 */

import { useEffect, useState } from 'preact/hooks';
import { useSpeechToText } from '@/client/hooks/chat/composer/speech-to-text';
import { useDictationConfig } from '@/client/hooks/chat/composer/dictation-settings';
import { dictationEngine } from '@/shared/lib/dictation/engines';
import { resolveDictationTag } from '@/shared/lib/dictation/languages';

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
  voiceToggle: () => void;
  /** Tooltip: engine and the language this utterance will be decoded as. */
  voiceHint: string;
  /** Non-null while a dictation error should be shown. Clears after 8 s. */
  displayedVoiceError: string | null;
}

export function useVoiceInput(onResult: (text: string) => void): UseVoiceInputReturn {
  const config = useDictationConfig();
  const {
    isSupported: voiceSupported,
    isListening: voiceListening,
    isTranscribing: voiceBusy,
    progressText,
    startListening,
    stopListening,
    error: voiceError,
  } = useSpeechToText({ onResult, config });

  const voiceToggle = () => {
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
    const timer = setTimeout(() => setDisplayedVoiceError(null), 8000);
    return () => clearTimeout(timer);
  }, [voiceError]);

  const languageTag = resolveDictationTag(config.engine, config.language);
  const voiceHint = `${dictationEngine(config.engine).label} — ${
    languageTag ?? 'detected per utterance'
  }`;

  return {
    voiceSupported,
    voiceListening,
    voiceBusy,
    voiceStatus: voiceBusy ? progressText : null,
    voiceToggle,
    voiceHint,
    displayedVoiceError,
  };
}
