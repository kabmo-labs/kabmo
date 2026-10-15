/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeAll, describe, expect, test } from 'bun:test';

import { bootSyntax, onLanguageReady, requestLanguage } from '@/shared/lib/code/highlighter';
import { findMatches } from '@/shared/lib/code/editor/find';
import { getLanguageFromPath } from '@/shared/lib/code/language';
import { highlightCode, highlightLines } from '@/shared/lib/code/syntax-highlight';
import { highlightCodeWindow } from '@/shared/lib/code/windowed-highlight';

/** Shiki emits `<span class="shiki">…` with dual-theme CSS variables per token. */
const SHIKI_RE = /<span class="shiki">/;
const SHIKI_TOKEN_RE = /--shiki-light:/;

/**
 * Every language these tests highlight. Grammars are fetched on demand, so the
 * suite asks for them up front and waits for the last one to land instead of
 * relying on a boot-time warmup that no longer exists.
 */
const HIGHLIGHT_LANGS = [
  'typescript',
  'tsx',
  'javascript',
  'jsx',
  'json',
  'markdown',
  'css',
  'bash',
  'yaml',
  'diff',
  'python',
  'go',
  'rust',
  'sql',
  'html',
  'php',
];

beforeAll(async () => {
  // The isomorphic highlighter only boots with `window` present; the Bun test
  // runtime has none. Stub it, boot, then remove the stub so other test files
  // see a pristine global.
  Object.assign(globalThis, { window: globalThis });
  await bootSyntax();
  Reflect.deleteProperty(globalThis, 'window');

  await new Promise<void>((resolve) => {
    const settle = () => {
      if (HIGHLIGHT_LANGS.every((lang) => requestLanguage(lang))) {
        off();
        resolve();
      }
    };
    const off = onLanguageReady(settle);
    settle();
  });
});

describe('highlightCode', () => {
  // Regression guard: when the highlighter fails to boot, highlightCode falls
  // back to escaped plain text. Asserting on emitted token spans fails loudly
  // if that fallback is ever taken.
  test('emits Shiki token markup rather than falling back to escaped text', () => {
    const html = highlightCode('const x: number = 42; // hi', 'typescript');

    expect(html).toMatch(SHIKI_RE);
    expect(html).toMatch(SHIKI_TOKEN_RE);
  });

  test('emits both light and dark theme variables per token', () => {
    const html = highlightCode('const x = 1;', 'javascript');

    expect(html).toContain('--shiki-light:');
    expect(html).toContain('--shiki-dark:');
    expect(html).not.toContain('color:');
  });

  test('highlights php', () => {
    const html = highlightCode('<?php echo "hi"; ?>', 'php');

    expect(html).toMatch(SHIKI_TOKEN_RE);
  });

  test.each([
    ['typescript', 'const x: number = 42;'],
    ['python', 'def foo():\n    return "bar"'],
    ['go', 'package main\nfunc main() {}'],
    ['rust', 'fn main() { println!("x"); }'],
    ['sql', 'SELECT * FROM t WHERE a = 1'],
    ['json', '{"k": true, "n": 1}'],
    ['html', '<div class="a">x</div>'],
    ['yaml', 'key: value'],
    ['bash', 'echo "$HOME"'],
    ['css', '.a { color: red; }'],
  ])('tokenizes %s', (language, code) => {
    expect(highlightCode(code, language)).toMatch(SHIKI_TOKEN_RE);
  });

  test('returns empty string for empty input', () => {
    expect(highlightCode('', 'typescript')).toBe('');
  });

  test('falls back to javascript for an unknown language', () => {
    expect(highlightCode('const x = 1;', 'not-a-language')).toMatch(SHIKI_TOKEN_RE);
  });

  test('escapes angle brackets so highlighted output is injection-safe', () => {
    const html = highlightCode('<script>alert(1)</script>', 'html');

    expect(html).not.toContain('<script>');
    expect(html).toMatch(/&(lt|#x3C;)/);
  });
});

describe('highlightCodeWindow', () => {
  const source = Array.from({ length: 120 }, (_, index) =>
    index === 0 ? 'export const first = 1;' : `export const value${index} = ${index}; // line ${index}`,
  ).join('\n');

  /** The wrapper the app's `.shiki span` colour rule depends on. */
  const unwrap = (html: string) => html.replace(/^<span class="shiki">/, '').replace(/<\/span>$/, '');

  test('wraps the window in the class the token colours are scoped to', () => {
    const window = highlightCodeWindow(source, 'typescript', { start: 0, end: 3 });

    // Without this class no `.shiki span` rule matches, so the tokens would
    // render in the plain ink colour.
    expect(window).toMatch(SHIKI_RE);
    expect(window.endsWith('</span>')).toBe(true);
  });

  test('returns only the requested lines, joined as the editor renders them', () => {
    const window = highlightCodeWindow(source, 'typescript', { start: 10, end: 13 });
    const rows = highlightLines(source, 'typescript');

    expect(unwrap(window).split('\n')).toEqual(rows.slice(10, 13));
  });

  test('keeps multi-line grammar state from the lines above the window', () => {
    const commented = ['/*', ' * a block comment', ' * spanning several lines', ' */', 'const after = 1;'].join('\n');
    const rows = highlightLines(commented, 'typescript');
    // Line 2 sits inside the comment, whose opening line is outside the window.
    const window = highlightCodeWindow(commented, 'typescript', { start: 2, end: 4 });

    expect(unwrap(window).split('\n')).toEqual(rows.slice(2, 4));
  });

  test('renders an over-long line as plain text instead of tokenizing it', () => {
    const minified = `const bundled = "${'x'.repeat(200)}";\nconst next = 1;`;
    const window = highlightCodeWindow(minified, 'javascript', { start: 0, end: 2 }, { maxLineLength: 50 });

    expect(window).toContain('const bundled');
    expect(unwrap(window).split('\n')[0]).not.toContain('--shiki-light:');
    expect(unwrap(window).split('\n')[1]).toContain('--shiki-light:');
  });

  test('returns nothing for a window outside the document', () => {
    expect(highlightCodeWindow('const a = 1;', 'typescript', { start: 5, end: 9 })).toBe('');
    expect(highlightCodeWindow('const a = 1;', 'typescript', { start: 0, end: 0 })).toBe('');
  });
});

describe('find marks', () => {
  const code = 'const alpha = 1;\nconst beta = alpha + 2;\n';
  const PLAIN = { matchCase: false, wholeWord: false, isRegex: false };
  /** The text of every mark, in order. A match spanning tokens is several
   *  fragments, so the assertion is on the fragments JOINED. */
  const marked = (html: string): string[] =>
    Array.from(html.matchAll(/<mark class="find-match"[^>]*>(.*?)<\/mark>/g), (match) => match[1]);

  test('splits a match across the tokens it spans, and marks every fragment current', () => {
    // `const alpha` is three tokens (`const`, ` `, `alpha`): each carries its
    // own fragment of the one match, which is why the CSS may not draw a
    // vertical edge per fragment.
    const line = highlightLines(code, 'typescript', { marks: [{ start: 0, end: 11 }], currentMark: 0 })[0];

    expect(marked(line).join('')).toBe('const alpha');
    expect(line.match(/data-find-current/g)?.length).toBe(3);
    expect(line.match(/<\/mark>/g)?.length).toBe(3);
  });

  test('marks every occurrence, and only the current one as current', () => {
    const marks = findMatches(code, 'alpha', PLAIN).matches;
    const lines = highlightLines(code, 'typescript', { marks, currentMark: 1 });

    expect(marked(lines[0]).join('')).toBe('alpha');
    expect(marked(lines[1]).join('')).toBe('alpha');
    expect(lines[0]).not.toContain('data-find-current');
    expect(lines[1]).toContain('data-find-current');
  });

  test('escapes the matched text it wraps', () => {
    const line = highlightLines('a < b', 'text', { marks: [{ start: 2, end: 3 }], currentMark: 0 })[0];

    expect(line).toContain('<mark class="find-match" data-find-current="">&lt;</mark>');
  });

  test('leaves the markup untouched when there are no marks', () => {
    const plain = highlightLines(code, 'typescript')[0];
    const empty = highlightLines(code, 'typescript', { marks: [], currentMark: -1 })[0];

    expect(empty).toBe(plain);
    expect(plain).not.toContain('<mark');
  });

  test('keeps a windowed match on its own line, re-based to the slice', () => {
    const marks = findMatches(code, 'alpha', PLAIN).matches;
    // The window renders line 1 only. The match on line 0 must not reappear on
    // line 1's text, and the current index (line 0's match) must not mark
    // anything here.
    const window = highlightCodeWindow(code, 'typescript', { start: 1, end: 2 }, { marks, currentMark: 0 });

    expect(marked(window).join('')).toBe('alpha');
    expect(window).not.toContain('data-find-current');
  });

  test('re-bases the current index onto the marks inside the window', () => {
    const marks = findMatches(code, 'alpha', PLAIN).matches;
    const window = highlightCodeWindow(code, 'typescript', { start: 1, end: 2 }, { marks, currentMark: 1 });

    expect(window.match(/data-find-current/g)?.length).toBe(1);
    expect(marked(window).join('')).toBe('alpha');
  });

  test('a mark reaching past the window is clipped to it', () => {
    // The last line has no trailing newline, so a mark that runs to the end of
    // the slice would be clamped by the rebase.
    const window = highlightCodeWindow(code, 'typescript', { start: 1, end: 3 }, {
      marks: [{ start: 30, end: 999 }],
      currentMark: 0,
    });

    expect(marked(window).join('')).toBe('alpha + 2;');
  });
});

describe('getLanguageFromPath', () => {
  test.each([
    ['a.ts', 'typescript'],
    ['a.tsx', 'tsx'],
    ['a.js', 'javascript'],
    ['a.jsx', 'jsx'],
    ['a.json', 'json'],
    ['a.md', 'markdown'],
    ['a.css', 'css'],
    ['a.sh', 'bash'],
    ['a.yaml', 'yaml'],
    ['a.yml', 'yaml'],
    ['a.html', 'html'],
    ['a.svg', 'xml'],
    ['a.xml', 'xml'],
    ['a.py', 'python'],
    ['a.go', 'go'],
    ['a.rs', 'rust'],
    ['a.sql', 'sql'],
    ['a.toml', 'toml'],
    ['a.java', 'java'],
    ['a.php', 'php'],
    ['a.vue', 'vue'],
    ['a.svelte', 'svelte'],
    ['a.astro', 'astro'],
  ])('maps %s to %s', (path, expected) => {
    expect(getLanguageFromPath(path)).toBe(expected);
  });

  test('strips a trailing line-range suffix', () => {
    expect(getLanguageFromPath('src/a.ts:12-30')).toBe('typescript');
  });

  test('a selector after the range does not hide the language', () => {
    // `read src/Read.tsx:205-215:raw` — the extension read as
    // `tsx:205-215:raw`, an unknown one, so the code surface rendered
    // unhighlighted. Every selector shape omp accepts is peeled now.
    expect(getLanguageFromPath('src/Read.tsx:205-215:raw')).toBe('tsx');
    expect(getLanguageFromPath('src/Read.tsx:raw')).toBe('tsx');
    expect(getLanguageFromPath('src/a.ts:50-')).toBe('typescript');
    expect(getLanguageFromPath('src/a.ts:50+150')).toBe('typescript');
    expect(getLanguageFromPath('src/a.ts:-60')).toBe('typescript');
    expect(getLanguageFromPath('src/a.ts:5-16,960-973')).toBe('typescript');
    expect(getLanguageFromPath('src/a.ts:19,59')).toBe('typescript');
    expect(getLanguageFromPath('src/a.ts:conflicts')).toBe('typescript');
    expect(getLanguageFromPath('a.py:10-20:raw')).toBe('python');
  });

  test('strips query and hash fragments', () => {
    expect(getLanguageFromPath('src/a.ts?x=1#L4')).toBe('typescript');
  });

  test('answers `text` for a path that names no language', () => {
    // `text` is a Shiki special language: always usable, no grammar fetched,
    // emitted escaped and uncoloured. The old `javascript` claimed a language
    // the input did not have — a `read xd://eval/browser` (a device doc) was
    // badged JAVASCRIPT and its prose was tokenized as code.
    expect(getLanguageFromPath()).toBe('text');
    expect(getLanguageFromPath('src/bin/run')).toBe('text');
  });

  test('answers `text` for an internal or web URL', () => {
    expect(getLanguageFromPath('xd://eval/browser')).toBe('text');
    expect(getLanguageFromPath('skill://diagnose')).toBe('text');
    expect(getLanguageFromPath('omp://')).toBe('text');
    expect(getLanguageFromPath('http://localhost:3221/')).toBe('text');
  });

  test.each([
    ['a.zig', 'zig'],
    ['a.ex', 'elixir'],
    ['a.dart', 'dart'],
    ['a.ml', 'ocaml'],
    ['a.hs', 'haskell'],
    ['a.nix', 'nix'],
    ['a.tf', 'hcl'],
    ['a.graphql', 'graphql'],
    ['a.sol', 'solidity'],
    ['a.r', 'r'],
    ['a.jl', 'julia'],
    ['a.erl', 'erlang'],
    ['a.cljs', 'clojure'],
    ['a.scm', 'scheme'],
    ['a.rkt', 'racket'],
    ['a.proto', 'protobuf'],
    ['a.ps1', 'powershell'],
    ['a.json5', 'json5'],
    ['a.less', 'less'],
    ['a.scss', 'scss'],
    ['a.sass', 'sass'],
    ['a.styl', 'stylus'],
    ['a.m', 'objective-c'],
    ['a.gradle', 'groovy'],
  ])('maps trending %s to %s', (path, expected) => {
    expect(getLanguageFromPath(path)).toBe(expected);
  });

  test('maps a bare Makefile via the lowercased last segment', () => {
    expect(getLanguageFromPath('Makefile')).toBe('makefile');
  });
});
