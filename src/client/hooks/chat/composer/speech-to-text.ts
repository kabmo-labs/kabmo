/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Composer dictation: capture the browser's microphone, hand the utterance to
 * Kabmo's dictation socket, and insert what the configured engine returns.
 *
 * Audio is captured as raw PCM16LE mono @16 kHz — the rate every engine takes —
 * and sent as ONE binary frame on release. The engine, the language and the
 * model are fixed before recording starts and travel in the socket's query
 * string, so the server can refuse an unusable combination at the upgrade rather
 * than after a minute of audio.
 *
 * Two local refusals happen BEFORE the round trip, because both are cheaper to
 * answer here and both otherwise produce text nobody said: a recording shorter
 * than `minMs`, and one whose level never rises above the silence floor (a
 * ~100 ms tap is the classic input for a Whisper "Thank you." hallucination).
 * A third refusal names a dead capture — every sample exactly zero — because
 * that is a microphone that never delivered, not a user who spoke softly; the
 * device side of it, including the macOS constraints that keep the capture
 * alive, is `capture.ts`.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { openCapture, type DictationCapture } from '@/client/hooks/chat/composer/capture';
import { concatSamples, float32ToPcm16 } from '@/shared/lib/dictation/audio';
import { DICTATION_NO_AUDIO, isDeadCapture, isSilent, utteranceMs } from '@/shared/lib/dictation/gate';
import {
  DICTATION_SAMPLE_RATE,
  decodeDictationServerFrame,
  dictationSocketPath,
  type DictationRequest,
} from '@/shared/lib/dictation/protocol';
import type { DictationConfig } from '@/shared/lib/dictation/settings';

export interface UseSpeechToTextOptions {
  /** Called with the final transcript. */
  onResult: (text: string) => void;
  /** The stored preference; read live so a settings edit applies next time. */
  config: DictationConfig;
}

export interface UseSpeechToTextReturn {
  /** Whether the browser can capture audio at all. */
  isSupported: boolean;
  /** True while the microphone is open. */
  isListening: boolean;
  /** True from release until the transcript (or a failure) arrives. */
  isTranscribing: boolean;
  /** Human-readable progress while transcribing ("Downloading model 42%"). */
  progressText: string | null;
  startListening: () => void;
  stopListening: () => void;
  error: string | null;
}

/** A pending timer; the handle differs between the DOM and Bun typings. */
type CaptureTimer = ReturnType<typeof setTimeout>;

/** The socket path for this config: engine, language and model, no audio. */
export function dictationRequestFor(config: DictationConfig): DictationRequest {
  return {
    engine: config.engine,
    language: config.language,
    ...(config.model.trim() ? { model: config.model.trim() } : {}),
  };
}

function dictationUrl(request: DictationRequest): string {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${location.host}${dictationSocketPath(request)}`;
}

export function useSpeechToText({ onResult, config }: UseSpeechToTextOptions): UseSpeechToTextReturn {
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [progressText, setProgressText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const captureRef = useRef<DictationCapture | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const autoStopRef = useRef<CaptureTimer | undefined>(undefined);
  /** Set by `stopListening` below; the auto-stop timer needs a stable seam. */
  const stopListeningRef = useRef<(() => void) | null>(null);

  const isSupported =
    typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function';

  /** Stop capturing and release the microphone; returns the recorded samples. */
  const releaseCapture = useCallback((): Float32Array[] => {
    clearTimeout(autoStopRef.current);
    autoStopRef.current = undefined;
    const capture = captureRef.current;
    captureRef.current = null;
    return capture?.release() ?? [];
  }, []);

  const fail = useCallback(
    (message: string) => {
      setError(message);
      setIsListening(false);
      setIsTranscribing(false);
      setProgressText(null);
      releaseCapture();
      socketRef.current?.close();
      socketRef.current = null;
    },
    [releaseCapture],
  );

  const send = useCallback(
    (chunks: Float32Array[], inputRate: number) => {
      const samples = concatSamples(chunks);
      const pcm16 = float32ToPcm16(samples, inputRate, DICTATION_SAMPLE_RATE);
      const bytes = new Uint8Array(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength);

      if (utteranceMs(bytes.byteLength) < config.minMs) {
        fail(`That was too short to transcribe (under ${config.minMs} ms).`);
        return;
      }
      // Before the silence floor: bit-exact zeros are a capture that delivered
      // nothing (a track WebKit ended, a muted device), not a quiet speaker.
      if (isDeadCapture(bytes)) {
        fail(DICTATION_NO_AUDIO);
        return;
      }
      if (isSilent(bytes)) {
        fail('No speech was detected in that recording.');
        return;
      }

      setIsTranscribing(true);
      setProgressText('Transcribing…');

      const socket = new WebSocket(dictationUrl(dictationRequestFor(config)));
      socketRef.current = socket;
      socket.binaryType = 'arraybuffer';

      socket.onopen = () => {
        // A copy: the buffer is a view over the resampled array and Bun's
        // serializer wants an owned frame.
        socket.send(bytes.slice().buffer);
      };

      socket.onmessage = (event) => {
        const frame = decodeDictationServerFrame(event.data);
        if (!frame) return;

        if (frame.type === 'progress') {
          setProgressText(
            frame.decoding
              ? 'Transcribing…'
              : frame.percent !== null
                ? `Downloading speech model ${frame.percent}%`
                : 'Downloading speech model…',
          );
          return;
        }

        if (frame.type === 'final') {
          setProgressText(null);
          setIsTranscribing(false);
          socket.close();
          socketRef.current = null;
          onResult(frame.text);
          return;
        }

        if (frame.type === 'error') {
          fail(frame.error);
        }
      };

      socket.onerror = () => {
        if (socketRef.current === socket) fail('Could not reach the dictation service.');
      };

      socket.onclose = () => {
        // A close before a final/error frame means the transcription never landed.
        if (socketRef.current === socket) fail('The dictation connection closed unexpectedly.');
      };
    },
    [config, fail, onResult],
  );

  const startListening = useCallback(() => {
    if (!isSupported) return;
    setError(null);
    setProgressText(null);

    void openCapture(config.deviceId, fail, { onDead: () => fail(DICTATION_NO_AUDIO) }).then(
      (capture) => {
        if (!capture) return;
        captureRef.current = capture;
        setIsListening(true);

        // A recording nobody stops would grow until the browser kills it.
        autoStopRef.current = setTimeout(() => {
          autoStopRef.current = undefined;
          stopListeningRef.current?.();
        }, config.maxMs);
      },
    );
  }, [config.deviceId, config.maxMs, fail, isSupported]);

  // The auto-stop timer is armed inside `startListening`, which must not depend
  // on `stopListening` (it would re-create the callback on every render and
  // restart the timer). One ref is the seam.
  const stopListening = useCallback(() => {
    setIsListening(false);
    const capture = captureRef.current;
    captureRef.current = null;
    clearTimeout(autoStopRef.current);
    autoStopRef.current = undefined;
    if (!capture) return;
    const inputRate = capture.inputRate();
    const chunks = capture.release();
    // No callback ran at all, so the recording ended inside the first 85 ms
    // buffer — necessarily under `minMs`. A dead capture is NOT this case: it
    // still runs callbacks (measured 11 in 1.2 s) and is refused by the gate in
    // `send`, so this cannot mask it.
    if (chunks.length === 0) {
      fail(`That was too short to transcribe (under ${config.minMs} ms).`);
      return;
    }
    send(chunks, inputRate);
  }, [config.minMs, fail, send]);

  useEffect(() => {
    stopListeningRef.current = stopListening;
  }, [stopListening]);

  useEffect(
    () => () => {
      releaseCapture();
      socketRef.current?.close();
      socketRef.current = null;
    },
    [releaseCapture],
  );

  return { isSupported, isListening, isTranscribing, progressText, startListening, stopListening, error };
}
