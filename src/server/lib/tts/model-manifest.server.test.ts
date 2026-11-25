/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';

import {
  catalogForUrl,
  detectArch,
  modelIdFromUrl,
} from '@/server/lib/tts/model-manifest.server';
import { LOCAL_TTS_CATALOG } from '@/shared/lib/tts/local-models';

const SUPERTONIC_FILES = [
  'LICENSE',
  'README.md',
  'duration_predictor.int8.onnx',
  'text_encoder.int8.onnx',
  'tts.json',
  'unicode_indexer.bin',
  'vector_estimator.int8.onnx',
  'vocoder.int8.onnx',
  'voice.bin',
];

describe('detectArch', () => {
  test('recognises a Supertonic bundle, int8 or fp32', () => {
    expect(detectArch(SUPERTONIC_FILES)).toBe('supertonic');
    expect(detectArch(SUPERTONIC_FILES.map((name) => name.replace('.int8.onnx', '.onnx')))).toBe('supertonic');
  });

  test('recognises a Kokoro bundle, and needs its tokens file', () => {
    expect(detectArch(['model.int8.onnx', 'voices.bin', 'tokens.txt', 'espeak-ng-data'])).toBe('kokoro');
    expect(detectArch(['model.int8.onnx', 'voices.bin'])).toBeNull();
  });

  test('refuses anything else instead of guessing', () => {
    expect(detectArch(['model.onnx', 'tokens.txt'])).toBeNull();
    expect(detectArch(['README.md'])).toBeNull();
    expect(detectArch([])).toBeNull();
  });
});

describe('modelIdFromUrl', () => {
  test('drops the archive suffix and keeps a readable name', () => {
    expect(modelIdFromUrl(
      'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/'
      + 'sherpa-onnx-supertonic-3-tts-int8-2026-05-11.tar.bz2',
    )).toBe('sherpa-onnx-supertonic-3-tts-int8-2026-05-11');
    expect(modelIdFromUrl('https://example.test/a/Bundle.TAR.GZ')).toBe('bundle');
    expect(modelIdFromUrl('https://example.test/a/model.tar.gz?token=x')).toBe('model');
  });

  test('sanitises what the filesystem cannot take, and never returns an empty id', () => {
    const escaped = modelIdFromUrl('https://example.test/a/..%2Fetc%2Fpasswd.tar.bz2');
    expect(escaped).not.toContain('/');
    expect(escaped).toBe('..-2fetc-2fpasswd');
    expect(modelIdFromUrl('https://example.test/')).toBe('model');
    expect(modelIdFromUrl('https://example.test/---.tar.bz2')).toBe('model');
  });
});

describe('catalogForUrl', () => {
  test('an exact catalog URL carries its metadata into a pasted install', () => {
    const url = LOCAL_TTS_CATALOG[0]!.sourceUrl!;
    expect(catalogForUrl(url)?.id).toBe(LOCAL_TTS_CATALOG[0]!.id);
    expect(catalogForUrl(`${url}?mirror=1`)).toBeUndefined();
    expect(catalogForUrl('https://example.test/other.tar.bz2')).toBeUndefined();
  });
});
