/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Declaration rules per language family.
 *
 * Every rule is a ROW, so adding a language means adding a table entry and its
 * scan (`scan.ts`), never touching the walk. Two invariants hold across all of
 * them and are asserted by the test that walks this file:
 *
 * - **Every regex carries the `d` flag.** The extractor takes the name's column
 *   from the match's own indices; without `d` the outline would have to search
 *   the line for the name and would pick the wrong occurrence on a line that
 *   mentions it twice.
 * - **Every regex is anchored at the line's start** (`^`). A declaration is
 *   recognised at the depth the walk is at, never mid-line.
 *
 * The families below are grouped by SYNTAX, not by file extension: a language
 * whose declarations look like C's reuses `C_FAMILY_RULES`, and the mapping
 * from a Shiki id to a family lives in `scan.ts`.
 */

import type { DeclarationRule, MemberRule } from '@/shared/lib/code/outline/rules';

/** C / C++ / C# / Objective-C / Java / Kotlin / Swift / Scala / Dart / Groovy. */
export const C_FAMILY_RULES: readonly DeclarationRule[] = [
  {
    kind: 'class',
    re: /^(?:(?:public|private|protected|internal|static|final|abstract|sealed|open|data|partial|export|declare)\s+)*(?:class|record|object)\s+([A-Za-z_$][\w$]*)/d,
  },
  { kind: 'struct', re: /^(?:(?:public|private|protected|internal|export|packed)\s+)*(?:struct|union)\s+([A-Za-z_$][\w$]*)/d },
  { kind: 'interface', re: /^(?:(?:public|private|protected|internal|static|abstract|sealed)\s+)*interface\s+([A-Za-z_$][\w$]*)/d },
  { kind: 'enum', re: /^(?:(?:public|private|protected|internal|static)\s+)*(?:enum|@interface)\s+([A-Za-z_$][\w$]*)/d },
  { kind: 'type', re: /^(?:(?:public|private|protected|internal|export)\s+)*(?:typedef|using)\b[^;=]*?\b([A-Za-z_]\w*)\s*(?:=|;|\{)/d },
  { kind: 'trait', re: /^(?:(?:public|private|protected)\s+)*trait\s+([A-Za-z_$][\w$]*)/d },
  { kind: 'module', re: /^(?:(?:public|internal|export)\s+)*(?:namespace|package)\s+([A-Za-z_$][\w$.]*)/d },
  {
    kind: 'function',
    re: /^(?:(?:public|private|protected|internal|static|final|abstract|synchronized|override|open|suspend|inline|async|extern|unsafe|virtual|sealed|export)\s+)*(?:fun|func|function|def|void|int|long|float|double|boolean|bool|char|byte|short|string|String|object|dynamic|var|auto|val|[A-Z][\w$<>[\],.? ]*)\s+([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(/d,
  },
  { kind: 'macro', re: /^#\s*(?:define|import)\s+([A-Za-z_]\w*)/d },
  { kind: 'constant', re: /^(?:static\s+)?(?:const|constexpr|let|var|val)\s+([A-Za-z_$][\w$]*)/d },
];

/** Members of a C-family class body: a method, then a field of any spelling. */
export const C_MEMBER_RULES: readonly MemberRule[] = [
  {
    kind: 'method',
    re: /^(?:(?:public|private|protected|internal|static|final|abstract|synchronized|override|open|suspend|inline|async|extern|unsafe|virtual|sealed|readonly)\s+)*(?:<[^>]*>\s*)?([A-Za-z_$][\w$]*)\s*\(/d,
  },
  {
    kind: 'variable',
    re: /^(?:(?:public|private|protected|internal|static|final|readonly|override|volatile|transient|val|var|let|const)\s+)*([A-Za-z_$][\w$]*)\s*(?::[^=;]+)?(?:=[^>]|;)/d,
  },
  {
    kind: 'variable',
    re: /^(?:(?:public|private|protected|internal|static|final|readonly|volatile|transient)\s+)*[A-Za-z_$][\w$<>[\],.?]*\s+([A-Za-z_$][\w$]*)\s*(?:=|;)/d,
  },
];

/** Go. */
export const GO_RULES: readonly DeclarationRule[] = [
  { kind: 'function', re: /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/d },
  { kind: 'struct', re: /^type\s+([A-Za-z_]\w*)\s+struct\b/d },
  { kind: 'interface', re: /^type\s+([A-Za-z_]\w*)\s+interface\b/d },
  { kind: 'type', re: /^type\s+([A-Za-z_]\w*)\s+/d },
  { kind: 'constant', re: /^(?:var|const)\s+([A-Za-z_]\w*)/d },
];

/** Rust. `impl` opens a scope the way a class does. */
export const RUST_RULES: readonly DeclarationRule[] = [
  { kind: 'function', re: /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:const\s+)?fn\s+([A-Za-z_]\w*)/d },
  { kind: 'struct', re: /^(?:pub(?:\([^)]*\))?\s+)?struct\s+([A-Za-z_]\w*)/d },
  { kind: 'enum', re: /^(?:pub(?:\([^)]*\))?\s+)?enum\s+([A-Za-z_]\w*)/d },
  { kind: 'trait', re: /^(?:pub(?:\([^)]*\))?\s+)?(?:unsafe\s+)?trait\s+([A-Za-z_]\w*)/d },
  { kind: 'module', re: /^(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_]\w*)/d },
  { kind: 'impl', re: /^(?:pub\s+)?impl(?:<[^>]*>)?\s+(?:[A-Za-z_][\w:<>]*\s+for\s+)?([A-Za-z_]\w*)/d },
  { kind: 'macro', re: /^(?:pub\s+)?macro_rules!\s*([A-Za-z_]\w*)/d },
  { kind: 'constant', re: /^(?:pub(?:\([^)]*\))?\s+)?(?:const|static)\s+([A-Za-z_]\w*)/d },
];

/** Ruby. */
export const RUBY_RULES: readonly DeclarationRule[] = [
  { kind: 'class', re: /^class\s+([A-Z][\w:]*)/d },
  { kind: 'module', re: /^module\s+([A-Z][\w:]*)/d },
  { kind: 'function', re: /^def\s+(?:self\.)?([A-Za-z_]\w*[?!=]?)/d },
  { kind: 'constant', re: /^([A-Z][A-Z0-9_]*)\s*=/d },
];

/** PHP. */
export const PHP_RULES: readonly DeclarationRule[] = [
  { kind: 'class', re: /^(?:(?:final|abstract|readonly)\s+)*(?:class|enum|trait)\s+([A-Za-z_]\w*)/d },
  { kind: 'interface', re: /^interface\s+([A-Za-z_]\w*)/d },
  { kind: 'function', re: /^(?:(?:public|private|protected|static|final|abstract)\s+)*function\s+&?([A-Za-z_]\w*)/d },
  { kind: 'constant', re: /^(?:const|define\s*\(\s*['"])([A-Za-z_]\w*)/d },
];

/** Lua. */
export const LUA_RULES: readonly DeclarationRule[] = [
  { kind: 'function', re: /^(?:local\s+)?function\s+([A-Za-z_][\w.:]*)/d },
  { kind: 'variable', re: /^local\s+([A-Za-z_]\w*)\s*=/d },
];

/** Python (indentation-nested; see `pythonOutline`). */
export const PYTHON_RULES: readonly DeclarationRule[] = [
  { kind: 'class', re: /^class\s+([A-Za-z_]\w*)/d },
  { kind: 'function', re: /^(?:async\s+)?def\s+([A-Za-z_]\w*)/d },
  { kind: 'constant', re: /^([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=/d },
];

/** Shell (bash / zsh / sh). */
export const SHELL_RULES: readonly DeclarationRule[] = [
  { kind: 'function', re: /^(?:function\s+)?([A-Za-z_][\w-]*)\s*\(\s*\)/d },
  { kind: 'function', re: /^function\s+([A-Za-z_][\w-]*)/d },
  { kind: 'variable', re: /^(?:export\s+|declare\s+(?:-\w+\s+)*|readonly\s+)?([A-Za-z_]\w*)=/d },
];

/** Elixir. */
export const ELIXIR_RULES: readonly DeclarationRule[] = [
  { kind: 'module', re: /^defmodule\s+([A-Z][\w.]*)/d },
  { kind: 'function', re: /^defp?\s+([a-z_]\w*[?!]?)/d },
  { kind: 'macro', re: /^defmacro\s+([a-z_]\w*[?!]?)/d },
  { kind: 'variable', re: /^@([a-z_]\w*)/d },
];

/** Erlang. */
export const ERLANG_RULES: readonly DeclarationRule[] = [
  { kind: 'module', re: /^-module\(([a-z_]\w*)\)/d },
  { kind: 'function', re: /^([a-z_]\w*)\s*\([^)]*\)\s*(?:when\s+.*)?->/d },
  { kind: 'macro', re: /^-define\(([A-Za-z_]\w*)/d },
];

/** Haskell / Elm / PureScript. */
export const HASKELL_RULES: readonly DeclarationRule[] = [
  { kind: 'module', re: /^module\s+([A-Z][\w.]*)/d },
  { kind: 'type', re: /^(?:data|newtype|type|type alias)\s+([A-Z][\w]*)/d },
  { kind: 'class', re: /^class\s+(?:\([^)]*\)\s*=>\s*)?([A-Z][\w]*)/d },
  { kind: 'function', re: /^([a-z_][\w']*)\s*(?:::|[^=]*=)/d },
];

/** OCaml / F#. */
export const OCAML_RULES: readonly DeclarationRule[] = [
  { kind: 'module', re: /^module\s+(?:type\s+)?([A-Z][\w]*)/d },
  { kind: 'type', re: /^type\s+(?:'[\w]+\s+)*([a-z_]\w*)/d },
  { kind: 'class', re: /^class\s+(?:virtual\s+)?([a-z_]\w*)/d },
  { kind: 'function', re: /^(?:let\s+rec\s+|let\s+|and\s+)([a-z_]\w*)/d },
];

/** Clojure / Scheme / Racket / Lisp. */
export const LISP_RULES: readonly DeclarationRule[] = [
  { kind: 'function', re: /^\(defn-?\s+([^\s()]+)/d },
  { kind: 'macro', re: /^\(defmacro\s+([^\s()]+)/d },
  { kind: 'variable', re: /^\(def\s+([^\s()]+)/d },
  { kind: 'module', re: /^\((?:ns|module|define-module|library)\s+\(?([^\s()]+)/d },
  { kind: 'function', re: /^\(define\s+\(([^\s()]+)/d },
  { kind: 'type', re: /^\(defrecord\s+([^\s()]+)/d },
  { kind: 'class', re: /^\(defclass\s+([^\s()]+)/d },
];

/** Zig. */
export const ZIG_RULES: readonly DeclarationRule[] = [
  { kind: 'function', re: /^(?:pub\s+)?(?:export\s+)?(?:inline\s+)?fn\s+([A-Za-z_]\w*)/d },
  { kind: 'struct', re: /^(?:pub\s+)?const\s+([A-Za-z_]\w*)\s*=\s*(?:extern\s+)?(?:packed\s+)?struct/d },
  { kind: 'enum', re: /^(?:pub\s+)?const\s+([A-Za-z_]\w*)\s*=\s*(?:packed\s+)?enum/d },
  { kind: 'constant', re: /^(?:pub\s+)?const\s+([A-Za-z_]\w*)/d },
  { kind: 'variable', re: /^(?:pub\s+)?var\s+([A-Za-z_]\w*)/d },
];

/** Julia. */
export const JULIA_RULES: readonly DeclarationRule[] = [
  { kind: 'module', re: /^(?:baremodule|module)\s+([A-Za-z_]\w*)/d },
  { kind: 'struct', re: /^(?:mutable\s+)?struct\s+([A-Za-z_]\w*)/d },
  { kind: 'interface', re: /^abstract\s+type\s+([A-Za-z_]\w*)/d },
  { kind: 'macro', re: /^macro\s+([A-Za-z_]\w*)/d },
  { kind: 'function', re: /^function\s+([A-Za-z_]\w*[!?]?)/d },
  { kind: 'function', re: /^([A-Za-z_]\w*[!?]?)\s*\([^)]*\)\s*(?:::[^=]+)?=/d },
  { kind: 'constant', re: /^const\s+([A-Za-z_]\w*)/d },
];

/** R. */
export const R_RULES: readonly DeclarationRule[] = [
  { kind: 'function', re: /^([A-Za-z._][\w.]*)\s*(?:<-|=)\s*function/d },
  { kind: 'variable', re: /^([A-Za-z._][\w.]*)\s*(?:<-|=)/d },
];

/** SQL. */
export const SQL_RULES: readonly DeclarationRule[] = [
  { kind: 'class', re: /^create\s+(?:or\s+replace\s+)?(?:table|view)\s+(?:if\s+not\s+exists\s+)?["`]?([\w.]+)/id },
  { kind: 'function', re: /^create\s+(?:or\s+replace\s+)?(?:function|procedure)\s+["`]?([\w.]+)/id },
  { kind: 'type', re: /^create\s+(?:or\s+replace\s+)?(?:type|domain|index)\s+(?:if\s+not\s+exists\s+)?["`]?([\w.]+)/id },
  { kind: 'constant', re: /^create\s+(?:or\s+replace\s+)?(?:sequence|schema)\s+(?:if\s+not\s+exists\s+)?["`]?([\w.]+)/id },
];

/** Protobuf / GraphQL SDL: named blocks. */
export const SDL_RULES: readonly DeclarationRule[] = [
  { kind: 'class', re: /^(?:message|type|input|object)\s+([A-Za-z_]\w*)/d },
  { kind: 'interface', re: /^(?:interface|service|union|scalar)\s+([A-Za-z_]\w*)/d },
  { kind: 'enum', re: /^enum\s+([A-Za-z_]\w*)/d },
  { kind: 'function', re: /^(?:query|mutation|subscription)\s+([A-Za-z_]\w*)/d },
  { kind: 'function', re: /^(?:rpc\s+)?([A-Za-z_]\w*)\s*\([^)]*\)\s*(?::|returns|;)/d },
];

/** HCL / Terraform. */
export const HCL_RULES: readonly DeclarationRule[] = [
  { kind: 'module', re: /^(?:resource|data|module|provider|variable|output|locals|terraform)\s+"([^"]+)"/d },
  { kind: 'function', re: /^([A-Za-z_]\w*)\s*=\s*\{/d },
];

/** Makefile. */
export const MAKE_RULES: readonly DeclarationRule[] = [
  { kind: 'function', re: /^([A-Za-z0-9_./-]+)\s*:(?!=)/d },
  { kind: 'variable', re: /^(?:export\s+)?([A-Za-z_]\w*)\s*[:?+]?=/d },
];

/** Dockerfile. */
export const DOCKERFILE_RULES: readonly DeclarationRule[] = [
  // A named stage is what later commands refer to, so it wins over the image.
  { kind: 'module', re: /^FROM\s+(?:--platform=\S+\s+)?\S+\s+[Aa][Ss]\s+(\S+)/d },
  { kind: 'module', re: /^FROM\s+(?:--platform=\S+\s+)?(\S+)/id },
  { kind: 'variable', re: /^(?:ARG|ENV)\s+([A-Za-z_]\w*)/d },
];

/** Nix. */
export const NIX_RULES: readonly DeclarationRule[] = [
  { kind: 'function', re: /^([A-Za-z_][\w'-]*)\s*=\s*(?:pkgs\.)?(?:lib\.)?(?:callPackage|\{)/d },
  { kind: 'variable', re: /^([A-Za-z_][\w'-]*)\s*=/d },
];

/** CSS / SCSS / Less / Stylus. */
export const CSS_RULES: readonly DeclarationRule[] = [
  { kind: 'macro', re: /^(@(?:mixin|function|keyframes)\s+[\w-]+)/d },
  { kind: 'selector', re: /^(@(?:media|supports|layer|container)\s+[^{]+)/d },
  { kind: 'selector', re: /^([.#&:][^{};]*(?:\s*,\s*[^{};]+)*)\s*\{/d },
  { kind: 'variable', re: /^(--[\w-]+|@[\w-]+|\$[\w-]+)\s*:/d },
];

/** Perl. */
export const PERL_RULES: readonly DeclarationRule[] = [
  { kind: 'module', re: /^package\s+([\w:]+)/d },
  { kind: 'function', re: /^sub\s+([A-Za-z_]\w*)/d },
];

/** Solidity. */
export const SOLIDITY_RULES: readonly DeclarationRule[] = [
  { kind: 'class', re: /^(?:abstract\s+)?(?:contract|library)\s+([A-Za-z_]\w*)/d },
  { kind: 'interface', re: /^interface\s+([A-Za-z_]\w*)/d },
  { kind: 'struct', re: /^struct\s+([A-Za-z_]\w*)/d },
  { kind: 'enum', re: /^enum\s+([A-Za-z_]\w*)/d },
  { kind: 'function', re: /^(?:function|modifier|constructor|fallback|receive)\s+([A-Za-z_]\w*)/d },
  { kind: 'variable', re: /^(?:event|error)\s+([A-Za-z_]\w*)/d },
];

/** PowerShell. */
export const POWERSHELL_RULES: readonly DeclarationRule[] = [
  { kind: 'class', re: /^class\s+([A-Za-z_]\w*)/d },
  { kind: 'enum', re: /^enum\s+([A-Za-z_]\w*)/d },
  { kind: 'function', re: /^(?:function|filter|workflow)\s+([A-Za-z_][\w-]*)/d },
];

/** HTML / XML / SVG / Vue / Svelte / Astro: element ids and component tags. */
export const MARKUP_RULES: readonly DeclarationRule[] = [
  { kind: 'tag', re: /^\s*<([A-Z][\w.]*)/d },
  { kind: 'tag', re: /^\s*<[a-z][\w-]*\b[^>]*\bid=["']([^"']+)["']/d },
];
