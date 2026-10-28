/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `toToolCallData` — the bridge from a parsed tool call to Kabmo's
 * rendered `ToolCallData` — and the blob-reference guard it shares a module
 * with.
 *
 * The status field is a three-way precedence (`isError` > `output` > streaming)
 * and the "output" test is `!== undefined`, so an empty string settles a call
 * exactly like a real answer. The stored input is the raw args minus the
 * synthetic `i` intent key, and an object left empty by that strip is dropped
 * so the card does not render an empty argument list. Images are attached only
 * when the result actually returned some (the key is absent, not `[]`).
 *
 * `isBlobImageRef` is deliberately just a case-sensitive prefix test: the
 * digest is validated later, by the server-side resolver, so a malformed ref
 * still has to be recognized as "externalized" here.
 */

import { describe, expect, test } from 'bun:test';
import {
  isBlobImageRef,
  toToolCallData,
  type ParsedToolCall,
} from '@/shared/lib/omp/session/parse-message-blocks';

describe('toToolCallData', () => {
  const parsed: ParsedToolCall = {
    id: 'c1',
    name: 'bash',
    title: 'bash — ls',
    intent: 'list files',
    target: '/tmp',
    command: 'ls',
    input: { i: 'list files', command: 'ls' },
  };

  test('streaming calls start running; settled calls start success', () => {
    expect(toToolCallData(parsed, { streaming: true }).status).toBe('running');
    expect(toToolCallData(parsed, { streaming: false }).status).toBe('success');
  });

  test('an output — even the empty string — overrides streaming to success', () => {
    const running = toToolCallData(parsed, { streaming: true });
    expect(running.output).toBeUndefined();
    expect(toToolCallData(parsed, { streaming: true, output: 'done' }).status).toBe('success');
    expect(toToolCallData(parsed, { streaming: true, output: '' }).status).toBe('success');
  });

  test('isError wins over both output and streaming', () => {
    expect(toToolCallData(parsed, { streaming: true, output: 'boom', isError: true }).status).toBe('error');
    expect(toToolCallData(parsed, { streaming: false, isError: true }).status).toBe('error');
  });

  test('maps identity, type and the parsed detail fields through', () => {
    const data = toToolCallData(parsed, { streaming: false });
    expect(data.id).toBe('c1');
    expect(data.type).toBe('bash');
    expect(data.name).toBe('bash');
    expect(data.title).toBe('bash — ls');
    expect(data.intent).toBe('list files');
    expect(data.target).toBe('/tmp');
    expect(data.command).toBe('ls');
  });

  test('strips the synthetic `i` key and drops an input left empty', () => {
    expect(toToolCallData(parsed, { streaming: false }).input).toEqual({ command: 'ls' });
    const onlyIntent: ParsedToolCall = { id: 'c', name: 't', title: 't', input: { i: 'x' } };
    expect(toToolCallData(onlyIntent, { streaming: false }).input).toBeUndefined();
    const stringInput: ParsedToolCall = { id: 'c', name: 't', title: 't', input: 'raw-args' };
    expect(toToolCallData(stringInput, { streaming: false }).input).toBe('raw-args');
  });

  test('a call with no input at all stays input-less', () => {
    const bare: ParsedToolCall = { id: 'c', name: 'todo', title: 'todo' };
    const data = toToolCallData(bare, { streaming: false });
    expect(data.input).toBeUndefined();
    expect(data.type).toBe('todo');
    expect(data.intent).toBeUndefined();
    expect(data.target).toBeUndefined();
    expect(data.command).toBeUndefined();
  });

  test('images are only attached when the result actually returned some', () => {
    const none = toToolCallData(parsed, { streaming: false, images: [] });
    expect('images' in none).toBe(false);
    const withImages = toToolCallData(parsed, {
      streaming: false,
      images: [{ mimeType: 'image/png', blobRef: 'blob:sha256:x' }],
    });
    expect(withImages.images).toEqual([{ mimeType: 'image/png', blobRef: 'blob:sha256:x' }]);
  });
});

describe('isBlobImageRef', () => {
  test('is a case-sensitive prefix test, not a digest validator', () => {
    expect(isBlobImageRef('blob:sha256:abc')).toBe(true);
    expect(isBlobImageRef('blob:sha256:')).toBe(true);
    expect(isBlobImageRef('blob:md5:abc')).toBe(false);
    expect(isBlobImageRef('Blob:sha256:abc')).toBe(false);
    expect(isBlobImageRef('')).toBe(false);
  });
});
