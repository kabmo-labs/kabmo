/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The runner transcript, made readable.
 *
 * The inputs are copied from a real 63 KB job log (measured): a BOM, one ISO
 * timestamp per line, `##[group]` markers and ANSI colour. The assertions exist
 * so a future change cannot quietly stop stripping the timestamp, and so a tail
 * cannot start mid-line.
 */

import { describe, expect, test } from 'bun:test';

import { cleanLine, cleanLog, tailOf } from './logtext';

describe('cleanLine', () => {
  test('drops the timestamp the runner prefixes to every line', () => {
    expect(cleanLine('2026-11-20T12:12:32.9658834Z Current runner version')).toBe('Current runner version');
  });

  test('drops ANSI colour and the BOM', () => {
    expect(cleanLine('\uFEFF2026-11-20T12:12:32.9658834Z \u001b[31mfailed\u001b[0m')).toBe('failed');
  });

  test('keeps the group title and drops the closing marker', () => {
    expect(cleanLine('2026-11-20T12:12:32.9678131Z ##[group]Runner Image Provisioner')).toBe(
      '▸ Runner Image Provisioner',
    );
    expect(cleanLine('2026-11-20T12:12:33Z ##[endgroup]')).toBe('');
  });

  test('keeps a warning and an error with GitHub’s own words', () => {
    expect(cleanLine('2026-11-20T12:19:33Z ##[warning]Node.js 20 is deprecated')).toBe(
      '⚠ Node.js 20 is deprecated',
    );
    expect(cleanLine('2026-11-20T12:19:33Z ##[error]Process completed with exit code 1')).toBe(
      '✗ Process completed with exit code 1',
    );
  });

  test('leaves an ordinary line alone', () => {
    expect(cleanLine('2026-11-20T12:12:32.9658834Z [command]/usr/bin/git status')).toBe(
      '[command]/usr/bin/git status',
    );
  });
});

describe('cleanLog', () => {
  test('cleans every line and trims only the trailing blanks', () => {
    const raw = [
      '\uFEFF2026-11-20T12:00:00Z first',
      '2026-11-20T12:00:01Z ##[group]Build',
      '2026-11-20T12:00:02Z ok',
      '',
      '',
    ].join('\n');
    expect(cleanLog(raw)).toBe('first\n▸ Build\nok');
  });

  test('keeps an interior blank line, because a log is evidence', () => {
    expect(cleanLog('2026-11-20T12:00:00Z a\n\n2026-11-20T12:00:01Z b')).toBe('a\n\nb');
  });
});

describe('tailOf', () => {
  test('a short text is returned whole and is not called truncated', () => {
    expect(tailOf('abc', 10)).toEqual({ text: 'abc', truncated: false });
  });

  test('a cut starts on a line boundary rather than mid-word', () => {
    const result = tailOf('one\ntwo\nthree', 9);
    expect(result.truncated).toBe(true);
    expect(result.text.endsWith('three')).toBe(true);
    expect(result.text.startsWith('one')).toBe(false);
    expect(result.text).toBe('two\nthree');
  });

  test('a cut inside a single long line keeps the fragment it has', () => {
    expect(tailOf('abcdefgh', 4)).toEqual({ text: 'efgh', truncated: true });
  });
});
