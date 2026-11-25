/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';

import { buildLocalConfig } from '@/server/lib/tts/engines/sherpa';

const SUPERTONIC_FILES = [
  'duration_predictor.int8.onnx',
  'text_encoder.int8.onnx',
  'vector_estimator.int8.onnx',
  'vocoder.int8.onnx',
  'tts.json',
  'unicode_indexer.bin',
  'voice.bin',
];

describe('buildLocalConfig', () => {
  test('a Supertonic directory resolves to its file paths', () => {
    const built = buildLocalConfig('/m', 'supertonic', SUPERTONIC_FILES);
    expect(built.missing).toEqual([]);
    const config = built.config as { model: { supertonic: Record<string, string> } };
    expect(config.model.supertonic.durationPredictor).toBe('/m/duration_predictor.int8.onnx');
    expect(config.model.supertonic.voiceStyle).toBe('/m/voice.bin');
  });

  test('a missing file is named instead of handing the addon a broken path', () => {
    const built = buildLocalConfig('/m', 'supertonic', ['tts.json']);
    expect(built.config).toBeNull();
    expect(built.missing).toContain('voice.bin');
    expect(built.missing).toContain('vocoder.onnx');
  });

  test('a Kokoro directory keeps its lexicons in one comma-joined field', () => {
    const built = buildLocalConfig('/k', 'kokoro', [
      'model.int8.onnx',
      'voices.bin',
      'tokens.txt',
      'lexicon-us-en.txt',
      'lexicon-zh.txt',
      'espeak-ng-data',
    ]);
    const config = built.config as { model: { kokoro: Record<string, string> } };
    expect(config.model.kokoro.lexicon).toBe('/k/lexicon-us-en.txt,/k/lexicon-zh.txt');
    // `dataDir` is ignored from sherpa-onnx 2.0, so it must not be sent at all.
    expect(config.model.kokoro).not.toHaveProperty('dataDir');
  });
});
