/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The search route's line parser: what a hit's text and its highlight ranges
 * become by the time the panel sees them — plus the argument vector the route
 * hands ripgrep, which is where a symbol query used to break.
 *
 * Two rules are asserted here because both fail silently on screen — the row
 * paints the wrong word rather than erroring:
 *
 * - ripgrep reports submatches in BYTES, and a line with one multi-byte
 *   character before the match shifts every range after it.
 * - `content` is trimmed before it travels, so the ranges must be shifted onto
 *   the trimmed text rather than left as offsets into the raw line.
 *
 * The `buildArgs` block is the regression net for a third: rg's positional
 * parser reads a `-`-leading token as a FLAG, so `-webkit-transform` searched
 * for `bkit-transform`, `--help` printed rg's help, and `->` exited 2. The
 * assertions are on the ARGUMENT VECTOR and on a real run, because the failure
 * mode was a plausible-looking empty result rather than an exception.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildArgs, parseRgLine } from '@/server/routes/fs/search';
import { runRipgrep } from '@/server/lib/fs/ripgrep';

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ompchamber-search-'));
  tempDirs.push(dir);
  return dir;
}

/** Run `buildArgs`' output the way the route does, collecting match frames. */
async function runQuery(dir: string, q: string, opts: { useRegex?: boolean; wholeWord?: boolean; matchCase?: boolean; includeFiles?: string } = {}) {
  let stdout = '';
  let stderr = '';
  const decoder = new TextDecoder();
  const code = await runRipgrep(
    buildArgs(q, opts.matchCase ?? false, opts.wholeWord ?? false, opts.useRegex ?? false, opts.includeFiles ?? ''),
    dir,
    {
      onStdout(chunk) {
        stdout += decoder.decode(chunk, { stream: true });
      },
      onStderr(chunk) {
        stderr += decoder.decode(chunk, { stream: true });
      },
    },
  );
  const matches = stdout.split('\n').filter((line) => line.includes('"type":"match"'));
  return { code, matches, stderr, jsonOnly: stdout.trim() === '' || stdout.trimStart().startsWith('{') };
}

afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe('buildArgs', () => {
  test('the pattern rides the --regexp flag, never the positional slot', () => {
    const args = buildArgs('useFoo(', false, false, false, '');
    expect(args).toContain('--regexp=useFoo(');
    // The positional slot is what let rg read a `-`-leading query as a flag.
    expect(args).not.toContain('useFoo(');
    expect(args.at(-1)).toBe('.');
  });

  test('literal mode adds -F; regex mode adds neither -F nor -e', () => {
    expect(buildArgs('x', false, false, false, '')).toContain('-F');
    const regex = buildArgs('x', false, false, true, '');
    expect(regex).not.toContain('-F');
    expect(regex).not.toContain('-e');
    expect(regex).toContain('--regexp=x');
  });

  test('the flags still travel', () => {
    expect(buildArgs('x', true, false, false, '')).not.toContain('-i');
    expect(buildArgs('x', false, false, false, '')).toContain('-i');
    expect(buildArgs('x', false, true, false, '')).toContain('-w');
  });

  test('includeFiles becomes one glob per comma-separated entry, trimmed', () => {
    const base = buildArgs('x', false, false, false, '');
    const args = buildArgs('x', false, false, false, '*.ts, src/*.md ,');
    // Three exclusion globs ride every search; the two include entries add two.
    expect(args.filter((a) => a === '--glob')).toHaveLength(base.filter((a) => a === '--glob').length + 2);
    expect(args).toContain('*.ts');
    expect(args).toContain('src/*.md');
  });
});

describe('dash-leading queries reach ripgrep as a pattern', () => {
  const dir = tempDir();
  fs.writeFileSync(
    path.join(dir, 'code.ts'),
    ['const webkit = "-webkit-transform: none;",', 'const help = "--help flag",', 'const arrow = (a) -> b;', 'const flag = "-i literal";', ''].join('\n'),
  );

  for (const q of ['-webkit-transform', '--help', '->', '-i']) {
    test(`a literal search for ${JSON.stringify(q)} returns its line`, async () => {
      const run = await runQuery(dir, q);
      // Exit 2 is rg refusing the vector; a non-JSON stdout is rg printing help
      // or its version instead of match frames.
      expect(run.jsonOnly).toBe(true);
      expect(run.code).not.toBe(2);
      expect(run.matches.length).toBeGreaterThan(0);
    });
  }

  test('a query that is only dashes still searches literally', async () => {
    const dashDir = tempDir();
    fs.writeFileSync(path.join(dashDir, 'd.txt'), 'a - b\nc -- d\n');
    const single = await runQuery(dashDir, '-');
    expect(single.code).not.toBe(2);
    expect(single.matches.length).toBeGreaterThan(0);
  });
});

describe('symbol queries are literal by default', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'code.ts'), ['const x = useFoo();', 'const y = arr[i];', 'const p = a ** b;', 'const o = obj?.field;', 'class Foo(Bar) {}', ''].join('\n'));

  for (const q of ['useFoo(', 'arr[i]', '**', '?.', 'Foo(Bar)']) {
    test(`${JSON.stringify(q)} matches without being read as a regex`, async () => {
      const run = await runQuery(dir, q);
      // Exit 2 here would be rg's "regex parse error" — the shape the panel
      // used to render as "No results found.".
      expect(run.code).not.toBe(2);
      expect(run.jsonOnly).toBe(true);
      expect(run.matches.length).toBeGreaterThan(0);
    });
  }

  test('regex mode still refuses an unescaped metacharacter, quoting rg verbatim', async () => {
    const run = await runQuery(dir, 'useFoo(', { useRegex: true });
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('regex parse error');
  });
});

/** One rg match frame, as `rg --json` emits it. */
function frame(lineText: string, submatches: { start: number; end: number }[]) {
  return JSON.stringify({
    type: 'match',
    data: {
      path: { text: './src/alpha.ts' },
      line_number: 12,
      lines: { text: lineText },
      submatches,
    },
  });
}

describe('parseRgLine', () => {
  test('strips the leading ./ from the path and trims the line', () => {
    const match = parseRgLine(frame('    const alpha = 1;\n', [{ start: 10, end: 15 }]));

    expect(match).toEqual({
      file: 'src/alpha.ts',
      line: '12',
      content: 'const alpha = 1;',
      ranges: [{ start: 6, end: 11 }],
    });
  });

  test('shifts ranges by the indentation the trim removed', () => {
    const match = parseRgLine(frame('\t\talpha beta alpha\n', [{ start: 2, end: 7 }, { start: 13, end: 18 }]));

    expect(match?.ranges).toEqual([{ start: 0, end: 5 }, { start: 11, end: 16 }]);
  });

  test('converts ripgrep byte offsets to character offsets', () => {
    // `é` is two bytes, so a byte range of 3..8 is characters 2..7.
    const raw = 'é alpha\n';
    const match = parseRgLine(frame(raw, [{ start: 3, end: 8 }]));

    expect(match?.content).toBe('é alpha');
    expect(match?.ranges).toEqual([{ start: 2, end: 7 }]);
  });

  test('drops a range the trim left outside the text', () => {
    // A match that was only trailing whitespace has nothing left to paint.
    const match = parseRgLine(frame('alpha   \n', [{ start: 7, end: 8 }]));

    expect(match?.content).toBe('alpha');
    expect(match?.ranges).toEqual([]);
  });

  test('a frame with no submatches still yields the line', () => {
    const match = parseRgLine(JSON.stringify({
      type: 'match',
      data: { path: { text: './a.ts' }, line_number: 1, lines: { text: 'alpha\n' } },
    }));

    expect(match).toEqual({ file: 'a.ts', line: '1', content: 'alpha', ranges: [] });
  });

  test('non-match frames are ignored', () => {
    expect(parseRgLine(JSON.stringify({ type: 'begin', data: { path: { text: './a.ts' } } }))).toBeNull();
    expect(parseRgLine('not json')).toBeNull();
  });
});
