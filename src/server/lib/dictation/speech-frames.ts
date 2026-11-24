/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The frame codec omp's worker speaks on stdin/stdout, decoded from its own
 * bundle (`packages/coding-agent/src/daemon/modules/speech-frames.ts` in
 * 19.1.1) and verified against the running worker:
 *
 *   u32le length | u8 kind | body
 *
 * - `length` EXCLUDES the 4-byte prefix and INCLUDES the kind byte.
 * - kind `0` — header only: `JSON`.
 * - kind `1` — `u32le headerLength | header JSON | Float32LE payload`.
 *
 * A Float32Array field travels as kind 1: the header carries `$pcm: <field>`
 * (and the field itself must be REMOVED from the header), the payload carries
 * the raw little-endian samples. The worker reattaches it after decoding.
 *
 * Measured on omp 19.1.1 with the model already cached: ping answered in 24 ms,
 * a 7 s utterance transcribed in ~0.9 s, and the transcript is byte-identical to
 * the same audio decoded in-process by transformers.js — which is what proves
 * the payload is not being shifted or truncated.
 */

const KIND_HEADER = 0;
const KIND_PAYLOAD = 1;
/** Offset of the body: 4-byte length + 1-byte kind. */
const BODY_OFFSET = 5;
/** Largest frame omp's decoder accepts. */
const MAX_FRAME_BYTES = 512 * 1024 * 1024;

/** The header field naming the Float32 payload's destination field. */
const PCM_FIELD = '$pcm';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface SpeechFrame {
  type: string;
  id?: string;
  [key: string]: unknown;
}

/**
 * Encode one frame.
 *
 * A `Float32Array` value is moved into the payload and named by `$pcm`, which is
 * the only way the worker accepts audio: sending the array inside the JSON turns
 * it into `{"0":…,"1":…}`, and the worker then fails with
 * `aud.subarray is not a function`.
 */
export function encodeSpeechFrame(frame: Record<string, unknown>): Uint8Array {
  for (const [key, value] of Object.entries(frame)) {
    if (!(value instanceof Float32Array)) continue;
    const header: Record<string, unknown> = { ...frame, [PCM_FIELD]: key };
    delete header[key];
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return withPayload(header, bytes);
  }
  const header = encoder.encode(JSON.stringify(frame));
  const out = new Uint8Array(BODY_OFFSET + header.length);
  new DataView(out.buffer).setUint32(0, 1 + header.length, true);
  out[4] = KIND_HEADER;
  out.set(header, BODY_OFFSET);
  return out;
}

function withPayload(header: Record<string, unknown>, payload: Uint8Array): Uint8Array {
  const json = encoder.encode(JSON.stringify(header));
  const out = new Uint8Array(BODY_OFFSET + 4 + json.length + payload.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, 1 + 4 + json.length + payload.length, true);
  out[4] = KIND_PAYLOAD;
  view.setUint32(BODY_OFFSET, json.length, true);
  out.set(json, BODY_OFFSET + 4);
  out.set(payload, BODY_OFFSET + 4 + json.length);
  return out;
}

/**
 * A streaming decoder: stdout arrives in arbitrary chunks, and a frame can span
 * two of them (or several frames can arrive in one).
 *
 * A malformed frame throws, because the alternative is silently answering with
 * the wrong transcript — the same choice omp's own decoder makes.
 */
export class SpeechFrameDecoder {
  private buffer = new Uint8Array(0);

  push(chunk: Uint8Array): SpeechFrame[] {
    this.append(chunk);
    const frames: SpeechFrame[] = [];
    let consumed = 0;
    for (;;) {
      if (this.buffer.length - consumed < 4) break;
      const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
      const length = view.getUint32(consumed, true);
      if (length < 1) throw new Error('speech frame: empty frame');
      if (length > MAX_FRAME_BYTES) throw new Error(`speech frame: ${length} bytes exceeds the frame limit`);
      if (this.buffer.length - consumed - 4 < length) break;
      frames.push(this.decodeAt(view, consumed, length));
      consumed += 4 + length;
    }
    if (consumed > 0) {
      this.buffer = this.buffer.slice(consumed);
    }
    return frames;
  }

  private decodeAt(view: DataView, at: number, length: number): SpeechFrame {
    const kind = this.buffer[at + 4];
    const body = this.buffer.subarray(at + BODY_OFFSET, at + 4 + length);

    if (kind === KIND_HEADER) {
      return JSON.parse(decoder.decode(body)) as SpeechFrame;
    }
    if (kind !== KIND_PAYLOAD) throw new Error(`speech frame: unknown type ${kind}`);
    if (body.length < 4) throw new Error('speech frame: truncated PCM header');

    const headerLength = view.getUint32(at + BODY_OFFSET, true);
    if (4 + headerLength > body.length) throw new Error('speech frame: PCM header overruns frame');
    const header = JSON.parse(decoder.decode(body.subarray(4, 4 + headerLength))) as Record<string, unknown>;
    const field = header[PCM_FIELD];
    delete header[PCM_FIELD];
    if (typeof field === 'string') {
      // `slice` rather than a view: the decoder's buffer is replaced as frames
      // are consumed, and a view would keep the whole read buffer alive.
      const bytes = body.slice(4 + headerLength);
      header[field] = new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4));
    }
    return header as SpeechFrame;
  }

  private append(chunk: Uint8Array): void {
    if (this.buffer.length === 0) {
      this.buffer = chunk.slice();
      return;
    }
    const merged = new Uint8Array(this.buffer.length + chunk.length);
    merged.set(this.buffer);
    merged.set(chunk, this.buffer.length);
    this.buffer = merged;
  }
}
