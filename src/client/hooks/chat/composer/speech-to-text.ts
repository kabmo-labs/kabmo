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
 *
 * Capture uses `AudioContext` + `ScriptProcessorNode`. The node is deprecated in
 * favour of `AudioWorklet`, but it is the only capture path shipped by every
 * target browser (Safari included) without serving a separate worklet module;
 * `MediaRecorder` is not an option because it emits Opus/WebM, which not every
 * engine accepts.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { concatSamples, float32ToPcm16 } from '@/shared/lib/dictation/audio';
import { describeCaptureFailure } from '@/shared/lib/dictation/capture-failure';
import { isSilent, utteranceMs } from '@/shared/lib/dictation/gate';
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

  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const inputRateRef = useRef(DICTATION_SAMPLE_RATE);
  const socketRef = useRef<WebSocket | null>(null);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Set by `stopListening` below; the auto-stop timer needs a stable seam. */
  const stopListeningRef = useRef<(() => void) | null>(null);

  const isSupported =
    typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function';

  /** Stop capturing and release the microphone; returns the recorded samples. */
  const releaseCapture = useCallback((): Float32Array[] => {
    clearTimeout(autoStopRef.current);
    autoStopRef.current = undefined;
    processorRef.current?.disconnect();
    processorRef.current = null;
    sourceRef.current?.disconnect();
    sourceRef.current = null;
    void contextRef.current?.close().catch(() => {});
    contextRef.current = null;
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    const chunks = chunksRef.current;
    chunksRef.current = [];
    return chunks;
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
    (chunks: Float32Array[]) => {
      const samples = concatSamples(chunks);
      const pcm16 = float32ToPcm16(samples, inputRateRef.current, DICTATION_SAMPLE_RATE);
      const bytes = new Uint8Array(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength);

      if (utteranceMs(bytes.byteLength) < config.minMs) {
        fail(`That was too short to transcribe (under ${config.minMs} ms).`);
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
    chunksRef.current = [];

    const deviceId = config.deviceId.trim();
    navigator.mediaDevices
      .getUserMedia({
        audio: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          // Speech capture: the three processors are what makes a laptop mic
          // usable in a room, and every target browser supports them.
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      .then((stream) => {
        streamRef.current = stream;
        try {
          const context = new AudioContext({ sampleRate: DICTATION_SAMPLE_RATE });
          contextRef.current = context;
          inputRateRef.current = context.sampleRate;

          const source = context.createMediaStreamSource(stream);
          sourceRef.current = source;
          const processor = context.createScriptProcessor(4096, 1, 1);
          processorRef.current = processor;
          processor.onaudioprocess = (event) => {
            chunksRef.current.push(new Float32Array(event.inputBuffer.getChannelData(0)));
          };
          source.connect(processor);
          processor.connect(context.destination);
          setIsListening(true);

          // A recording nobody stops would grow until the browser kills it.
          autoStopRef.current = setTimeout(() => {
            autoStopRef.current = undefined;
            stopListeningRef.current?.();
          }, config.maxMs);
        } catch {
          // The microphone IS open at this point, so the failure is the audio
          // graph, not the permission — and the stream has to be released or
          // the OS keeps showing the microphone in use.
          fail('Could not start audio capture.');
        }
      })
      .catch((cause: unknown) => {
        setError(describeCaptureFailure(cause));
      });
  }, [config.deviceId, config.maxMs, fail, isSupported]);

  // The auto-stop timer is armed inside `startListening`, which must not depend
  // on `stopListening` (it would re-create the callback on every render and
  // restart the timer). One ref is the seam.
  const stopListening = useCallback(() => {
    setIsListening(false);
    const chunks = releaseCapture();
    if (chunks.length === 0) return;
    send(chunks);
  }, [releaseCapture, send]);

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
