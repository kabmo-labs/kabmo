/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';
import { speechChunks, speakableText } from '@/shared/lib/tts/speakable';

describe('speakableText', () => {
  test('drops fenced code and tables', () => {
    const text = speakableText([
      'Here is the fix.',
      '```ts',
      'const secret = 1;',
      '```',
      '| a | b |',
      '| - | - |',
      'Done.',
    ].join('\n'));
    expect(text).not.toContain('secret');
    expect(text).not.toContain('|');
    expect(text).toContain('Here is the fix.');
    expect(text).toContain('Done.');
  });

  test('speaks a link label, a URL host and a path basename', () => {
    const text = speakableText(
      'See [the docs](https://example.com/a/b) or https://github.com/foo/bar?x=1 and `src/lib/tts/player.ts`.',
    );
    expect(text).toContain('the docs');
    expect(text).not.toContain('example.com/a/b');
    expect(text).toContain('github.com');
    expect(text).toContain('player.ts');
  });

  test('strips heading, quote and bullet markers but keeps list numbers', () => {
    const text = speakableText('## Plan\n> quoted\n- first\n1. second');
    expect(text).not.toContain('#');
    expect(text).not.toContain('>');
    expect(text).toContain('Plan');
    expect(text).toContain('1. second');
  });

  test('punctuation-only prose is not speech', () => {
    expect(speakableText('...')).toBe('');
    expect(speakableText('```\nonly code\n```')).toBe('');
  });
});

describe('speechChunks', () => {
  test('keeps the first request small so audio starts sooner', () => {
    const text = Array.from({ length: 20 }, (_, i) => `Sentence number ${i + 1} is here.`).join(' ');
    const chunks = speechChunks(text, 400, 120);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].length).toBeLessThanOrEqual(120);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(400);
  });

  test('never exceeds the engine budget, even without punctuation', () => {
    const chunks = speechChunks('word '.repeat(500), 100, 100);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(100);
      expect(chunk.length).toBeGreaterThan(0);
    }
  });

  test('joins the pieces back into the original prose', () => {
    const text = 'One sentence. Two sentences! Three sentences?';
    expect(speechChunks(text, 1000).join(' ')).toBe(text);
  });

  test('an answer with nothing speakable produces no request', () => {
    expect(speechChunks('```\ncode only\n```', 1000)).toEqual([]);
  });
});
