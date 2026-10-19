/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The outline extractor's rules, asserted on inputs that each broke a simpler
 * version of it.
 *
 * The three properties every case is really checking:
 *
 * - a declaration inside a body is NOT a symbol (a local `const` is not an
 *   outline row, and a `for (const …)` loop is not a method);
 * - a brace in a comment or a string does not move the depth count, which is
 *   what keeps every LATER declaration at the level it actually has;
 * - a line number points at the declaration's own line, because a row's only
 *   job is to take the reader there.
 */

import { describe, expect, test } from 'bun:test';
import { extractOutline, outlineForPath } from '@/shared/lib/code/outline/extract';
import { OUTLINE_KINDS } from '@/shared/lib/code/outline/types';
import { OUTLINE_KIND_MARKS } from '@/client/components/common/outline-kind-icon';

const names = (text: string, language: string) => extractOutline(text, language).map((s) => `${s.kind}:${s.name}@${s.line}`);

describe('TypeScript outline', () => {
  test('reports top-level declarations, in source order, with their own line', () => {
    const source = [
      'import { x } from "y";',
      '',
      'export interface Options {',
      '  flag: boolean;',
      '}',
      '',
      'export type Mode = "a" | "b";',
      '',
      'const LIMIT = 10;',
      '',
      'export async function load(path: string) {',
      '  const local = 1;',
      '  return local;',
      '}',
      '',
      'export const run = async (input: string) => {',
      '  return input;',
      '};',
      '',
      'export class Service {',
      '  readonly name = "svc";',
      '  private count = 0;',
      '',
      '  constructor(private readonly dep: Dep) {}',
      '',
      '  async start(): Promise<void> {',
      '    for (const viewer of [1, 2]) {',
      '      this.count += viewer;',
      '    }',
      '  }',
      '',
      '  stop = () => {',
      '    this.count = 0;',
      '  };',
      '}',
    ].join('\n');

    expect(names(source, 'typescript')).toEqual([
      'interface:Options@3',
      'type:Mode@7',
      'constant:LIMIT@9',
      'function:load@11',
      'function:run@16',
      'class:Service@20',
      'variable:name@21',
      'variable:count@22',
      'method:start@26',
      'method:stop@32',
    ]);
  });

  test('a brace inside a comment or a string does not move the depth count', () => {
    const source = [
      '// a comment with an unbalanced { brace',
      'const template = `',
      '  { not a real brace }',
      '`;',
      'const other = "{";',
      '/* block { comment',
      '   still { open */',
      'export function after() {}',
    ].join('\n');

    // `after` is at depth 0 — a scanner that counted the comment's brace would
    // report it as a member (or drop it entirely).
    expect(names(source, 'typescript')).toEqual([
      'constant:template@2',
      'constant:other@5',
      'function:after@8',
    ]);
  });

  test('a local declaration inside a function body is not a symbol', () => {
    const source = [
      'export function outer() {',
      '  const inner = 1;',
      '  function helper() {}',
      '  return inner;',
      '}',
    ].join('\n');
    expect(names(source, 'typescript')).toEqual(['function:outer@1']);
  });

  test('an arrow function field is a method, a plain field is a variable', () => {
    const source = [
      'class Store {',
      '  count = 0;',
      '  readonly label: string = "x";',
      '  handle = async (event: Event) => {',
      '    return event;',
      '  };',
      '}',
    ].join('\n');
    expect(names(source, 'typescript')).toEqual([
      'class:Store@1',
      'variable:count@2',
      'variable:label@3',
      'method:handle@4',
    ]);
  });

  test('a nested class is not listed as a member of its parent', () => {
    const source = ['class Outer {', '  inner() {}', '}', 'class Next {}'].join('\n');
    expect(names(source, 'typescript')).toEqual(['class:Outer@1', 'method:inner@2', 'class:Next@4']);
  });
});

describe('other languages', () => {
  test('python uses indentation, and a closure is not a member', () => {
    const source = [
      'import os',
      'CONST = 1',
      'lower = 2',
      '',
      'class Alpha:',
      '    field = 3',
      '',
      '    def method_one(self):',
      '        def inner():',
      '            pass',
      '        return 1',
      '',
      'def top_level(a):',
      '    return a',
    ].join('\n');
    expect(names(source, 'python')).toEqual([
      'constant:CONST@2',
      'class:Alpha@5',
      'method:method_one@8',
      'function:top_level@13',
    ]);
  });

  test('go reports func, struct, interface and package-level values', () => {
    const source = [
      'package main',
      'type Server struct {',
      '  Name string',
      '}',
      'type Handler interface {',
      '  Serve()',
      '}',
      'func New(name string) *Server {',
      '  return &Server{Name: name}',
      '}',
      'var Default = New("x")',
    ].join('\n');
    expect(names(source, 'go')).toEqual([
      'struct:Server@2',
      'interface:Handler@5',
      'function:New@8',
      'constant:Default@11',
    ]);
  });

  test('rust reports impl blocks and their members', () => {
    const source = [
      'pub struct Cache {',
      '  size: usize,',
      '}',
      'impl Cache {',
      '  pub fn new() -> Self {',
      '    Self { size: 0 }',
      '  }',
      '}',
      'pub trait Store {',
      '  fn get(&self) -> usize;',
      '}',
    ].join('\n');
    expect(names(source, 'rust')).toEqual([
      'struct:Cache@1',
      'impl:Cache@4',
      'method:new@5',
      'trait:Store@9',
      'method:get@10',
    ]);
  });

  test('markdown reports headings and skips fenced code', () => {
    const source = [
      '# Title',
      '',
      '```sh',
      '# not a heading',
      '```',
      '',
      '## Section',
      '### Deeper',
    ].join('\n');
    expect(extractOutline(source, 'markdown')).toEqual([
      { name: 'Title', kind: 'heading', line: 1, column: 3, depth: 0 },
      { name: 'Section', kind: 'heading', line: 7, column: 4, depth: 1 },
      { name: 'Deeper', kind: 'heading', line: 8, column: 5, depth: 2 },
    ]);
  });

  test('a language with no scan answers an empty list rather than a guess', () => {
    expect(extractOutline('{"a": 1}', 'json')).toEqual([]);
    expect(extractOutline('', 'typescript')).toEqual([]);
    expect(extractOutline('a\nb', 'text')).toEqual([]);
  });
});

describe('path resolution and kind coverage', () => {
  test('the language comes off the path, selector included', () => {
    expect(outlineForPath('src/App.tsx:23-300:raw', 'export function App() {}')).toEqual([
      { name: 'App', kind: 'function', line: 1, column: 17, depth: 0 },
    ]);
    expect(outlineForPath('README.md', '# Hi')).toEqual([
      { name: 'Hi', kind: 'heading', line: 1, column: 3, depth: 0 },
    ]);
  });

  test('every kind has a mark, and the table covers the union exactly', () => {
    expect(Object.keys(OUTLINE_KIND_MARKS).sort()).toEqual([...OUTLINE_KINDS].sort());
  });
});
