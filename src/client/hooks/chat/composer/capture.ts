/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The microphone half of dictation: open the device, run the audio graph, and
 * hand back what it recorded.
 *
 * Split from the hook because none of this needs Preact state — and because the
 * three things that made dictation fail silently on macOS are all here, each
 * with the measurement behind it:
 *
 * 1. **No echo cancellation** (`shared/lib/dictation/constraints.ts`). A true
 *    value makes WebKit build a VoiceProcessingIO unit, and on this machine the
 *    bind of the default input to it fails (`CoreAudioCaptureUnit::setupAudioUnit
 *    … capture device ID 53, error -10851`) and `captureFailed` ends the track.
 *    Every sample was then zero.
 * 2. **The context must be RUNNING.** One created outside the click's own task
 *    starts suspended and delivers no callbacks at all, which reads as silence.
 * 3. **A dead stream has to be named.** A failed unit still runs callbacks — 11
 *    zero-filled ones in 1.2 s, measured — so a bit-exact-zero buffer is
 *    refused after `DICTATION_DEAD_PROBE_MS` instead of blaming the speaker.
 *
 * A `ScriptProcessorNode` only runs while it reaches `destination`; the path
 * there is a gain of 0, because `destination` is the SPEAKERS and echo
 * cancellation is off.
 */

import { concatSamples, float32ToPcm16 } from '@/shared/lib/dictation/audio';
import { describeCaptureFailure } from '@/shared/lib/dictation/capture-failure';
import { dictationAudioConstraints } from '@/shared/lib/dictation/constraints';
import { DICTATION_NO_AUDIO, isDeadCapture } from '@/shared/lib/dictation/gate';
import { DICTATION_SAMPLE_RATE } from '@/shared/lib/dictation/protocol';

/**
 * How long a capture may deliver nothing but zeros before it is called dead.
 *
 * A working microphone never produces bit-exact zeros — this machine's input
 * measured ~0.006 RMS in a quiet room — so the first buffer is already
 * conclusive. The window is generous only so a slow first callback is never
 * mistaken for a dead device.
 */
const DICTATION_DEAD_PROBE_MS = 400;

/** A pending capture timer. */
type CaptureTimer = ReturnType<typeof setTimeout>;

/** What the capture reports while the microphone is open. */
export interface CaptureEvents {
  /** The stream delivered nothing, or its track ended underneath the page. */
  onDead: () => void;
}

/** An open microphone; `release` is the only way to close it. */
export interface DictationCapture {
  /** Stop capturing, release the device, and return what was recorded. */
  release: () => Float32Array[];
  /** The rate the chunks were captured at, for the one resample on the way out. */
  inputRate: () => number;
}

/** Samples captured so far, refused when they are all exactly zero. */
function deadProbe(chunks: readonly Float32Array[], rate: number): boolean {
  if (chunks.length === 0) return false;
  const pcm = float32ToPcm16(concatSamples(chunks), rate, DICTATION_SAMPLE_RATE);
  return isDeadCapture(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));
}

/**
 * Open the microphone and start recording.
 *
 * Resolves `null` after reporting a refusal or a failed graph through
 * `onFailure`, so the caller has one shape to handle: a capture, or nothing.
 */
export async function openCapture(
  deviceId: string,
  onFailure: (message: string) => void,
  events: CaptureEvents,
): Promise<DictationCapture | null> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: dictationAudioConstraints(deviceId),
    });
  } catch (cause) {
    onFailure(describeCaptureFailure(cause));
    return null;
  }

  let closed = false;
  const chunks: Float32Array[] = [];
  let context: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let processor: ScriptProcessorNode | null = null;
  let probe: CaptureTimer | undefined;

  const close = () => {
    closed = true;
    clearTimeout(probe);
    probe = undefined;
    processor?.disconnect();
    processor = null;
    source?.disconnect();
    source = null;
    void context?.close().catch(() => {});
    context = null;
    // `closed` is set first, so the track's own `ended` listener — which reports
    // a dead capture — cannot fire for this teardown.
    for (const track of stream.getTracks()) track.stop();
  };

  try {
    // The hardware rate, deliberately: WebKit does honour a requested
    // `sampleRate` (measured, a 16 kHz context delivered 16 kHz buffers), but the
    // default keeps ONE resampler in charge — `float32ToPcm16` — instead of a
    // WebKit-internal conversion plus ours.
    context = new AudioContext();
    if (context.state === 'suspended') await context.resume();
    if (context.state !== 'running') {
      throw new Error('the audio context did not start');
    }
    const rate = context.sampleRate;

    source = context.createMediaStreamSource(stream);
    processor = context.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (event) => {
      chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
    };
    const mute = context.createGain();
    mute.gain.value = 0;
    source.connect(processor);
    processor.connect(mute);
    mute.connect(context.destination);

    for (const track of stream.getAudioTracks()) {
      if (track.readyState === 'ended') throw new Error('the capture track had already ended');
      track.addEventListener('ended', () => {
        if (!closed) events.onDead();
      });
    }

    probe = setTimeout(() => {
      probe = undefined;
      if (!closed && deadProbe(chunks, rate)) events.onDead();
    }, DICTATION_DEAD_PROBE_MS);

    return {
      release: () => {
        const recorded = chunks.slice();
        close();
        return recorded;
      },
      inputRate: () => rate,
    };
  } catch {
    // The microphone IS open at this point, so the failure is the audio graph,
    // not the permission — and the stream has to be released or the OS keeps
    // showing the microphone in use. A track that is already `ended` is the
    // other case: the device died before the graph could use it.
    const trackEnded = stream.getAudioTracks().some((track) => track.readyState === 'ended');
    close();
    onFailure(trackEnded ? DICTATION_NO_AUDIO : 'Could not start audio capture.');
    return null;
  }
}
