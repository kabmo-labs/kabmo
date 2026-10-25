/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Which legacy stream mode backs each Shiki language id.
 *
 * The code surface highlights with Shiki and, since this table, ALSO parses with
 * a `StreamLanguage` — which is what makes bracket matching token-aware. There
 * is no lezer grammar here on purpose: measured, a lezer parser costs 39 KB gzip
 * for JavaScript alone, covers 24 of the 59 languages this app names, and is
 * WRONG about brackets until its lazy parse catches up (3 wrong pairs at mount
 * on a 176-line file, and 2 still wrong on a 337-line one after a full parse). A
 * stream mode is ~1 KB, covers 38 of the 59, and is correct at mount because its
 * tree is built from the token stream with no parse worker.
 *
 * Two rules govern this table.
 *
 * **It is keyed by Shiki id, not by mode name.** `getLanguageFromPath` already
 * answers a Shiki id for every extension, and that id is what the surface has in
 * hand. A second naming scheme would mean two places to keep in step.
 *
 * **An id absent here keeps the textual matcher.** That is the honest state for
 * the ids with no mode (php, graphql, nix, svelte, …): a wrong pair inside a
 * string is better than no pairs at all, and `bracketMatching()` still answers
 * every ordinary case. `TEXTUAL_ONLY_LANGS` names them so the gap is a decision
 * rather than an omission, and a test asserts the two sets cover every language
 * `shiki-langs` knows.
 *
 * ## Why the loaders are literal, one `import` per entry
 *
 * A template-literal specifier (`import(\`…/mode/${name}\`)`) builds fine but
 * NEVER RESOLVES at runtime in the dev server: Bun rewrites it to
 * `hmr.dynamicImport('@codemirror/legacy-modes/mode/${ref.module}')` with the
 * placeholder unsubstituted, so the mode silently failed to load and the surface
 * stayed on the textual matcher — measured in the browser, with no console error.
 * The repo's proven pattern is `LANG_LOADERS`, one literal specifier per entry,
 * which is what this mirrors.
 *
 * They are lazy for the same reason: all 38 modes in one bundle is +85 KB gzip,
 * and a tab opened on a README should pay for none of it.
 */

/** One stream mode: which module, and which export inside it. */
export interface StreamModeRef {
  /** The module's specifier, as written in the loader table. */
  module: string;
  /** The export to take from it — several modules ship more than one mode. */
  export: string;
}

/**
 * The mode module for each Shiki id, as a lazy literal import.
 *
 * Every entry was checked against the installed `@codemirror/legacy-modes`: the
 * module exists, and the export named in `STREAM_MODE_EXPORTS` is a real mode
 * object (a test resolves all of them).
 */
export const STREAM_MODE_LOADERS: Record<string, () => Promise<unknown>> = {
  // JavaScript family — one module ships four modes.
  typescript: () => import('@codemirror/legacy-modes/mode/javascript'),
  tsx: () => import('@codemirror/legacy-modes/mode/javascript'),
  javascript: () => import('@codemirror/legacy-modes/mode/javascript'),
  jsx: () => import('@codemirror/legacy-modes/mode/javascript'),
  json5: () => import('@codemirror/legacy-modes/mode/javascript'),
  json: () => import('@codemirror/legacy-modes/mode/javascript'),

  // Data and config
  yaml: () => import('@codemirror/legacy-modes/mode/yaml'),
  toml: () => import('@codemirror/legacy-modes/mode/toml'),
  ini: () => import('@codemirror/legacy-modes/mode/properties'),
  properties: () => import('@codemirror/legacy-modes/mode/properties'),
  hcl: () => import('@codemirror/legacy-modes/mode/properties'),

  // Markup and styles
  css: () => import('@codemirror/legacy-modes/mode/css'),
  less: () => import('@codemirror/legacy-modes/mode/css'),
  scss: () => import('@codemirror/legacy-modes/mode/css'),
  sass: () => import('@codemirror/legacy-modes/mode/sass'),
  stylus: () => import('@codemirror/legacy-modes/mode/stylus'),
  xml: () => import('@codemirror/legacy-modes/mode/xml'),

  // Shell and scripting
  bash: () => import('@codemirror/legacy-modes/mode/shell'),
  python: () => import('@codemirror/legacy-modes/mode/python'),
  ruby: () => import('@codemirror/legacy-modes/mode/ruby'),
  perl: () => import('@codemirror/legacy-modes/mode/perl'),
  lua: () => import('@codemirror/legacy-modes/mode/lua'),
  powershell: () => import('@codemirror/legacy-modes/mode/powershell'),

  // Compiled and systems
  go: () => import('@codemirror/legacy-modes/mode/go'),
  rust: () => import('@codemirror/legacy-modes/mode/rust'),
  c: () => import('@codemirror/legacy-modes/mode/clike'),
  cpp: () => import('@codemirror/legacy-modes/mode/clike'),
  csharp: () => import('@codemirror/legacy-modes/mode/clike'),
  java: () => import('@codemirror/legacy-modes/mode/clike'),
  kotlin: () => import('@codemirror/legacy-modes/mode/clike'),
  scala: () => import('@codemirror/legacy-modes/mode/clike'),
  dart: () => import('@codemirror/legacy-modes/mode/clike'),
  'objective-c': () => import('@codemirror/legacy-modes/mode/clike'),
  swift: () => import('@codemirror/legacy-modes/mode/swift'),

  // Functional
  haskell: () => import('@codemirror/legacy-modes/mode/haskell'),
  elixir: () => import('@codemirror/legacy-modes/mode/erlang'),
  erlang: () => import('@codemirror/legacy-modes/mode/erlang'),
  clojure: () => import('@codemirror/legacy-modes/mode/clojure'),
  scheme: () => import('@codemirror/legacy-modes/mode/scheme'),
  racket: () => import('@codemirror/legacy-modes/mode/scheme'),
  ocaml: () => import('@codemirror/legacy-modes/mode/mllike'),

  // Other
  r: () => import('@codemirror/legacy-modes/mode/r'),
  julia: () => import('@codemirror/legacy-modes/mode/julia'),
  sql: () => import('@codemirror/legacy-modes/mode/sql'),
  dockerfile: () => import('@codemirror/legacy-modes/mode/dockerfile'),
  protobuf: () => import('@codemirror/legacy-modes/mode/protobuf'),
  makefile: () => import('@codemirror/legacy-modes/mode/cmake'),
  groovy: () => import('@codemirror/legacy-modes/mode/groovy'),
};

/**
 * The export to take from each id's module.
 *
 * Separate from the loaders because several modules ship more than one mode
 * (`javascript` has four, `clike` has fourteen, `sql` has fifteen) and the
 * export name is not derivable from the Shiki id — `objective-c` is
 * `objectiveC`, `scss` is `sCSS`, `dockerfile` is `dockerFile`.
 */
export const STREAM_MODE_EXPORTS: Record<string, string> = {
  typescript: 'typescript',
  tsx: 'typescript',
  javascript: 'javascript',
  jsx: 'javascript',
  json5: 'json',
  json: 'json',

  yaml: 'yaml',
  toml: 'toml',
  ini: 'properties',
  properties: 'properties',
  hcl: 'properties',

  css: 'css',
  less: 'less',
  scss: 'sCSS',
  sass: 'sass',
  stylus: 'stylus',
  xml: 'xml',

  bash: 'shell',
  python: 'python',
  ruby: 'ruby',
  perl: 'perl',
  lua: 'lua',
  powershell: 'powerShell',

  go: 'go',
  rust: 'rust',
  c: 'c',
  cpp: 'cpp',
  csharp: 'csharp',
  java: 'java',
  kotlin: 'kotlin',
  scala: 'scala',
  dart: 'dart',
  'objective-c': 'objectiveC',
  swift: 'swift',

  haskell: 'haskell',
  elixir: 'erlang',
  erlang: 'erlang',
  clojure: 'clojure',
  scheme: 'scheme',
  racket: 'scheme',
  ocaml: 'oCaml',

  r: 'r',
  julia: 'julia',
  sql: 'standardSQL',
  dockerfile: 'dockerFile',
  protobuf: 'protobuf',
  makefile: 'cmake',
  groovy: 'groovy',
};

/**
 * Shiki ids this build can NOT make token-aware.
 *
 * Listed rather than left implicit so the gap is a statement: these keep the
 * textual bracket matcher, and a test asserts the two sets together cover every
 * id `shiki-langs` knows — a new language added there without a decision here
 * fails rather than silently falling back.
 */
export const TEXTUAL_ONLY_LANGS: readonly string[] = [
  'markdown',
  'html',
  'diff',
  'graphql',
  'nix',
  'svelte',
  'astro',
  'vue',
  // No mode ships for these, and `clike` is a FACTORY (not a mode), so a
  // language with no dedicated export cannot borrow one.
  'zig',
  'solidity',
  'php',
  'text',
];

/** The mode for a Shiki id, or null when this build has none. */
export function streamModeFor(language: string): StreamModeRef | null {
  const loader = STREAM_MODE_LOADERS[language];
  const exportName = STREAM_MODE_EXPORTS[language];
  if (!loader || !exportName) return null;
  return { module: language, export: exportName };
}

/** The lazy loader for a Shiki id, or null. */
export function streamModeLoader(language: string): (() => Promise<unknown>) | null {
  return STREAM_MODE_LOADERS[language] ?? null;
}
