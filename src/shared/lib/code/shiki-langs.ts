/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Single source of truth for the Shiki grammars this app can highlight.
 *
 * Keys are Shiki language ids (hyphens included: `objective-c`, `dockerfile`)
 * so a key can be passed straight to `highlighter.codeToHtml({ lang })`.
 * Every value is a lazy dynamic import, so a grammar is only fetched when the
 * highlighter actually loads it — the initial bundle stays small.
 */

export const LANG_LOADERS: Record<string, () => Promise<unknown>> = {
  typescript: () => import('@shikijs/langs/typescript'),
  tsx: () => import('@shikijs/langs/tsx'),
  javascript: () => import('@shikijs/langs/javascript'),
  jsx: () => import('@shikijs/langs/jsx'),
  json: () => import('@shikijs/langs/json'),
  markdown: () => import('@shikijs/langs/markdown'),
  css: () => import('@shikijs/langs/css'),
  bash: () => import('@shikijs/langs/bash'),
  diff: () => import('@shikijs/langs/diff'),
  yaml: () => import('@shikijs/langs/yaml'),
  html: () => import('@shikijs/langs/html'),
  python: () => import('@shikijs/langs/python'),
  go: () => import('@shikijs/langs/go'),
  rust: () => import('@shikijs/langs/rust'),
  sql: () => import('@shikijs/langs/sql'),
  toml: () => import('@shikijs/langs/toml'),
  java: () => import('@shikijs/langs/java'),
  c: () => import('@shikijs/langs/c'),
  cpp: () => import('@shikijs/langs/cpp'),
  csharp: () => import('@shikijs/langs/csharp'),
  ruby: () => import('@shikijs/langs/ruby'),
  php: () => import('@shikijs/langs/php'),
  kotlin: () => import('@shikijs/langs/kotlin'),
  swift: () => import('@shikijs/langs/swift'),
  scala: () => import('@shikijs/langs/scala'),
  lua: () => import('@shikijs/langs/lua'),
  perl: () => import('@shikijs/langs/perl'),
  dockerfile: () => import('@shikijs/langs/dockerfile'),
  ini: () => import('@shikijs/langs/ini'),
  properties: () => import('@shikijs/langs/properties'),
  zig: () => import('@shikijs/langs/zig'),
  elixir: () => import('@shikijs/langs/elixir'),
  dart: () => import('@shikijs/langs/dart'),
  ocaml: () => import('@shikijs/langs/ocaml'),
  haskell: () => import('@shikijs/langs/haskell'),
  nix: () => import('@shikijs/langs/nix'),
  hcl: () => import('@shikijs/langs/hcl'),
  graphql: () => import('@shikijs/langs/graphql'),
  solidity: () => import('@shikijs/langs/solidity'),
  r: () => import('@shikijs/langs/r'),
  julia: () => import('@shikijs/langs/julia'),
  erlang: () => import('@shikijs/langs/erlang'),
  clojure: () => import('@shikijs/langs/clojure'),
  scheme: () => import('@shikijs/langs/scheme'),
  racket: () => import('@shikijs/langs/racket'),
  protobuf: () => import('@shikijs/langs/protobuf'),
  makefile: () => import('@shikijs/langs/makefile'),
  powershell: () => import('@shikijs/langs/powershell'),
  json5: () => import('@shikijs/langs/json5'),
  less: () => import('@shikijs/langs/less'),
  scss: () => import('@shikijs/langs/scss'),
  sass: () => import('@shikijs/langs/sass'),
  stylus: () => import('@shikijs/langs/stylus'),
  'objective-c': () => import('@shikijs/langs/objective-c'),
  groovy: () => import('@shikijs/langs/groovy'),
  vue: () => import('@shikijs/langs/vue'),
  svelte: () => import('@shikijs/langs/svelte'),
  astro: () => import('@shikijs/langs/astro'),
  xml: () => import('@shikijs/langs/xml'),
};

/**
 * Languages pre-transpiled during boot. The first highlight of a grammar costs
 * ~700 ms to transpile, so warming all 58 would delay readiness by minutes;
 * these are the ones the chat timeline hits on nearly every session.
 */
export const EAGER_LANGS = [
  'typescript',
  'tsx',
  'javascript',
  'jsx',
  'json',
  'bash',
  'python',
  'markdown',
  'yaml',
  'diff',
];
