/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Node addon's surface, as much of it as Kabmo uses.
 *
 * Hand-written because the package ships JSDoc typedefs and no `.d.ts`
 * (`"types": null` in its manifest). Only the members this server calls are
 * declared; anything else would be a guess that ages into a lie.
 */
declare module 'sherpa-onnx-node' {
  export interface GeneratedAudio {
    samples: Float32Array;
    sampleRate: number;
  }

  export interface TtsGenerateRequest {
    text: string;
    sid?: number;
    lang?: string;
    speed?: number;
  }

  export class OfflineTts {
    constructor(config: unknown);
    readonly numSpeakers: number;
    readonly sampleRate: number;
    readonly lang: string;
    generate(request: TtsGenerateRequest): GeneratedAudio;
  }

  /** The module namespace itself, for a lazily-imported handle. */
  export interface SherpaRuntime {
    OfflineTts: typeof OfflineTts;
  }
}
