/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * How each language writes a line comment.
 *
 * The only thing the editor still needs from the old text-command layer:
 * CodeMirror's `toggleComment` reads its tokens out of the `languageData` facet
 * and needs no syntax tree, so this table IS the whole of the comment feature.
 * Everything else the old module did (line moves, duplicates, deletes, inserts,
 * indent, occurrences, edit replication) is a CM6 command now.
 *
 * The default is `//`, which is right for every C-family grammar. The exceptions
 * are the ones a wrong token would visibly break — `#` in YAML is a syntax
 * error, not a comment — and a language that has ONLY block comments gets the
 * wrapper, because a `//` inserted into CSS comments out nothing and breaks the
 * rule it was added to.
 */

/** A line-comment syntax: a prefix per line, or a wrapper for block-only languages. */
export type CommentSyntax = { line: string } | { block: readonly [string, string] };

const COMMENT_SYNTAX: Record<string, CommentSyntax> = {
  python: { line: '#' },
  bash: { line: '#' },
  yaml: { line: '#' },
  toml: { line: '#' },
  ruby: { line: '#' },
  perl: { line: '#' },
  r: { line: '#' },
  makefile: { line: '#' },
  dockerfile: { line: '#' },
  ini: { line: '#' },
  properties: { line: '#' },
  elixir: { line: '#' },
  graphql: { line: '#' },
  nix: { line: '#' },
  sql: { line: '--' },
  lua: { line: '--' },
  haskell: { line: '--' },
  css: { block: ['/*', '*/'] },
  scss: { block: ['/*', '*/'] },
  less: { block: ['/*', '*/'] },
  sass: { block: ['/*', '*/'] },
  stylus: { block: ['/*', '*/'] },
  html: { block: ['<!--', '-->'] },
  xml: { block: ['<!--', '-->'] },
  markdown: { block: ['<!--', '-->'] },
};

export function commentSyntaxFor(language: string): CommentSyntax {
  return COMMENT_SYNTAX[language] ?? { line: '//' };
}
