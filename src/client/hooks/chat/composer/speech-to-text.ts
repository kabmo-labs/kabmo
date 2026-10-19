/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Composer dictation: capture the browser's microphone, hand the utterance to
 * Kabmo's dictation socket, and insert what omp's local STT returns.
 *
 * Audio is captured as raw PCM16LE mono @16 kHz — the rate omp's worker expects
 * — and sent as ONE frame on release, because omp's STT is not incremental (its
 * own TUI inserts text when the utterance ends). The socket's other direction
 * carries the reason a first request is slow: the model download.
 *
 * Capture uses `AudioContext` + `ScriptProcessorNode`. The node is deprecated
 * in favour of `AudioWorklet`, but it is the only capture path shipped by every
 * target browser (Safari included) without serving a separate worklet module;
 * `MediaRecorder` is not an option because it emits Opus/WebM, which the worker
 * cannot decode.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { concatSamples, float32ToPcm16 } from '@/shared/lib/dictation/audio';
import { DICTATION_SAMPLE_RATE } from '@/shared/lib/dictation/protocol';
import type { DictationServerFrame } from '@/shared/lib/dictation/protocol';

export interface UseSpeechToTextOptions {
  /** Called with the final transcript. */
  onResult: (text: string) => void;
  /** omp model key; the server falls back to its default when omitted. */
  modelKey?: string;
  /** BCP 47 tag (`id-ID`, `en-US`). Omitted lets the model auto-detect. */
  language?: string;
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

/** Base64-encode bytes for the JSON frame. */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function dictationUrl(): string {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${location.host}/api/dictation/ws`;
}

export function useSpeechToText({ onResult, modelKey, language }: UseSpeechToTextOptions): UseSpeechToTextReturn {
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

  const isSupported =
    typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function';

  /** Stop capturing and release the microphone; returns the recorded samples. */
  const releaseCapture = useCallback((): Float32Array[] => {
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

  const startListening = useCallback(() => {
    if (!isSupported) return;
    setError(null);
    setProgressText(null);
    chunksRef.current = [];

    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        streamRef.current = stream;
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
      })
      .catch((cause: unknown) => {
        const name = cause instanceof DOMException ? cause.name : '';
        setError(name === 'NotAllowedError' ? 'Microphone permission denied.' : 'Could not open the microphone.');
      });
  }, [isSupported]);

  const stopListening = useCallback(() => {
    setIsListening(false);
    const chunks = releaseCapture();
    if (chunks.length === 0) return;

    const samples = concatSamples(chunks);
    if (samples.length === 0) return;
    const pcm16 = float32ToPcm16(samples, inputRateRef.current, DICTATION_SAMPLE_RATE);
    const audio = toBase64(new Uint8Array(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength));

    setIsTranscribing(true);
    setProgressText('Transcribing…');

    const socket = new WebSocket(dictationUrl());
    socketRef.current = socket;

    socket.onopen = () => {
      socket.send(JSON.stringify({ type: 'transcribe', audio, modelKey, language }));
    };

    socket.onmessage = (event) => {
      let frame: DictationServerFrame;
      try {
        frame = JSON.parse(String(event.data)) as DictationServerFrame;
      } catch {
        return;
      }

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
  }, [fail, language, modelKey, onResult, releaseCapture]);

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
