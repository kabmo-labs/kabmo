/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The language table and the three walks it drives.
 *
 * **Why rules and not an AST.** Speed does not decide it — measured on a
 * 350-line file the masked pass takes 0.37–0.51 ms against 0.26–0.59 ms for
 * `ts.createSourceFile`, and across 11 MB it is 273 ms against 264 ms. What
 * decides it is coverage and weight: `typescript` alone is 8.7 MB and answers
 * one of the 59 ids this editor can open, and every other language would need
 * its own parser (tree-sitter ships a WASM grammar per language) inside the
 * client bundle. The outline needs a name, a kind and a line, and it reads
 * those directly. A missing row is honest; a row pointing at the wrong line is
 * not, which is why names come from the rule's own match indices.
 *
 * Four walks, chosen per language by its own syntax (see `walk.ts`):
 *
 * - `braces` — C family, Go, Rust, PHP, … Declarations at depth 0, plus
 *   members one level inside a scope the file itself declared.
 * - `indent` — Python and YAML-style nesting, where a dedent closes the scope.
 * - `flat` — no nesting worth reporting (Ruby's `end`, Lua's blocks, SQL,
 *   config formats). A declaration is recognised wherever it starts.
 */

import { getLanguageFromPath } from '@/shared/lib/code/language';
import { TS_MEMBER_RULES } from '@/shared/lib/code/outline/rules';
import type { ScanSpec } from '@/shared/lib/code/outline/spec';
import {
  bracedOutline,
  flatOutline,
  indentOutline,
  jsonOutline,
  markdownOutline,
} from '@/shared/lib/code/outline/walk';
import {
  C_FAMILY_RULES,
  C_MEMBER_RULES,
  CSS_RULES,
  DOCKERFILE_RULES,
  ELIXIR_RULES,
  ERLANG_RULES,
  GO_RULES,
  HASKELL_RULES,
  HCL_RULES,
  JULIA_RULES,
  LISP_RULES,
  LUA_RULES,
  MAKE_RULES,
  MARKUP_RULES,
  NIX_RULES,
  OCAML_RULES,
  PHP_RULES,
  PERL_RULES,
  POWERSHELL_RULES,
  PYTHON_RULES,
  R_RULES,
  RUBY_RULES,
  RUST_RULES,
  SDL_RULES,
  SHELL_RULES,
  SOLIDITY_RULES,
  SQL_RULES,
  ZIG_RULES,
} from '@/shared/lib/code/outline/languages';
import { TS_RULES } from '@/shared/lib/code/outline/rules';
import type { OutlineSymbol } from '@/shared/lib/code/outline/types';

export type { Nesting, ScanSpec } from '@/shared/lib/code/outline/spec';

const C_LIKE: Omit<ScanSpec, 'rules'> = {
  mask: 'c',
  nesting: 'braces',
  // A namespace body holds classes, so it opens a scope as well. The walk
  // tells the two apart: a type body may not hold another type, a namespace
  // may.
  scopes: ['class', 'module', 'interface', 'struct', 'trait', 'enum'],
  members: true,
  memberRules: C_MEMBER_RULES,
};

/** Every Shiki id the editor can resolve, and how each one is scanned. */
export const SCAN_BY_LANGUAGE: Record<string, ScanSpec> = {
  // An interface says nothing worth a row per member, and `flag: boolean;`
  // would read as a variable of the file — only a class body is scanned.
  typescript: { ...C_LIKE, rules: TS_RULES, memberRules: TS_MEMBER_RULES, scopes: ['class'] },
  tsx: { ...C_LIKE, rules: TS_RULES, memberRules: TS_MEMBER_RULES, scopes: ['class'] },
  javascript: { ...C_LIKE, rules: TS_RULES, memberRules: TS_MEMBER_RULES, scopes: ['class'] },
  jsx: { ...C_LIKE, rules: TS_RULES, memberRules: TS_MEMBER_RULES, scopes: ['class'] },
  java: { ...C_LIKE, rules: C_FAMILY_RULES },
  c: { ...C_LIKE, rules: C_FAMILY_RULES },
  cpp: { ...C_LIKE, rules: C_FAMILY_RULES },
  csharp: { ...C_LIKE, rules: C_FAMILY_RULES },
  'objective-c': { ...C_LIKE, rules: C_FAMILY_RULES },
  kotlin: { ...C_LIKE, rules: C_FAMILY_RULES },
  swift: { ...C_LIKE, rules: C_FAMILY_RULES },
  scala: { ...C_LIKE, rules: C_FAMILY_RULES },
  dart: { ...C_LIKE, rules: C_FAMILY_RULES },
  groovy: { ...C_LIKE, rules: C_FAMILY_RULES },
  solidity: { ...C_LIKE, rules: SOLIDITY_RULES },
  php: { mask: 'c', nesting: 'braces', rules: PHP_RULES, scopes: ['class', 'interface', 'trait'], members: true },
  go: { mask: 'c', nesting: 'braces', rules: GO_RULES },
  rust: { mask: 'c', nesting: 'braces', rules: RUST_RULES, scopes: ['impl', 'trait'], members: true },
  zig: { mask: 'c', nesting: 'braces', rules: ZIG_RULES, scopes: ['struct', 'enum'], members: true },
  hcl: { mask: 'hcl', nesting: 'braces', rules: HCL_RULES },
  protobuf: { mask: 'c', nesting: 'braces', rules: SDL_RULES, scopes: ['class', 'interface'], members: true },
  graphql: { mask: 'hash', nesting: 'braces', rules: SDL_RULES, scopes: ['class', 'interface'], members: true },
  css: { mask: 'css', nesting: 'braces', rules: CSS_RULES, scopes: ['selector'] },
  less: { mask: 'css', nesting: 'braces', rules: CSS_RULES, scopes: ['selector'] },
  scss: { mask: 'css', nesting: 'braces', rules: CSS_RULES, scopes: ['selector'] },
  sass: { mask: 'css', nesting: 'braces', rules: CSS_RULES, scopes: ['selector'] },
  stylus: { mask: 'css', nesting: 'braces', rules: CSS_RULES, scopes: ['selector'] },
  ruby: { mask: 'hash', nesting: 'flat', rules: RUBY_RULES },
  lua: { mask: 'lua', nesting: 'flat', rules: LUA_RULES },
  elixir: { mask: 'hash', nesting: 'flat', rules: ELIXIR_RULES },
  erlang: { mask: 'percent', nesting: 'flat', rules: ERLANG_RULES },
  haskell: { mask: 'hash', nesting: 'flat', rules: HASKELL_RULES, dedupe: true },
  ocaml: { mask: 'ml', nesting: 'flat', rules: OCAML_RULES },
  julia: { mask: 'hash', nesting: 'flat', rules: JULIA_RULES },
  r: { mask: 'hash', nesting: 'flat', rules: R_RULES },
  clojure: { mask: 'lisp', nesting: 'flat', rules: LISP_RULES },
  scheme: { mask: 'lisp', nesting: 'flat', rules: LISP_RULES },
  racket: { mask: 'lisp', nesting: 'flat', rules: LISP_RULES },
  perl: { mask: 'hash', nesting: 'flat', rules: PERL_RULES },
  powershell: { mask: 'hash', nesting: 'flat', rules: POWERSHELL_RULES },
  bash: { mask: 'hash', nesting: 'flat', rules: SHELL_RULES },
  sql: { mask: 'sql', nesting: 'flat', rules: SQL_RULES },
  makefile: { mask: 'hash', nesting: 'flat', rules: MAKE_RULES },
  dockerfile: { mask: 'hash', nesting: 'flat', rules: DOCKERFILE_RULES },
  nix: { mask: 'hash', nesting: 'flat', rules: NIX_RULES },
  python: { mask: 'python', nesting: 'indent', rules: PYTHON_RULES },
  yaml: {
    mask: 'hash',
    nesting: 'indent',
    rules: [{ kind: 'key', re: /^([A-Za-z_$][\w$.-]*)\s*:/d }],
  },
  toml: {
    mask: 'hash',
    nesting: 'flat',
    rules: [
      { kind: 'module', re: /^\[\[?([^\]]+)\]\]?/d },
      { kind: 'key', re: /^([A-Za-z_][\w.-]*)\s*=/d },
    ],
  },
  ini: {
    mask: 'none',
    nesting: 'flat',
    rules: [
      { kind: 'module', re: /^\[([^\]]+)\]/d },
      { kind: 'key', re: /^([A-Za-z_][\w.-]*)\s*[=:]/d },
    ],
  },
  properties: { mask: 'none', nesting: 'flat', rules: [{ kind: 'key', re: /^([A-Za-z_][\w.-]*)\s*[=:]/d }] },
  json: { mask: 'raw', nesting: 'json', rules: [] },
  json5: { mask: 'raw', nesting: 'json', rules: [] },
  html: { mask: 'raw', nesting: 'flat', rules: MARKUP_RULES },
  xml: { mask: 'raw', nesting: 'flat', rules: MARKUP_RULES },
  svg: { mask: 'raw', nesting: 'flat', rules: MARKUP_RULES },
  vue: { mask: 'raw', nesting: 'flat', rules: MARKUP_RULES },
  svelte: { mask: 'raw', nesting: 'flat', rules: MARKUP_RULES },
  astro: { mask: 'raw', nesting: 'flat', rules: MARKUP_RULES },
  markdown: { mask: 'none', nesting: 'markdown', rules: [] },
  diff: { mask: 'none', nesting: 'flat', rules: [] },
};

/** The outline of `text`, scanned as `language` (a Shiki id). */
export function scanOutline(text: string, language: string): OutlineSymbol[] {
  const spec = SCAN_BY_LANGUAGE[language];
  if (!text || !spec) return [];
  const lines = text.split('\n');
  if (spec.nesting === 'markdown') return markdownOutline(lines);
  if (spec.nesting === 'json') return jsonOutline(lines);
  if (spec.nesting === 'indent') return indentOutline(lines, spec);
  if (spec.nesting === 'flat') return flatOutline(lines, spec);
  return bracedOutline(lines, spec);
}

/** The outline for a path, resolving the language the same way the editor does. */
export function outlineForPath(path: string, text: string): OutlineSymbol[] {
  return scanOutline(text, getLanguageFromPath(path));
}

