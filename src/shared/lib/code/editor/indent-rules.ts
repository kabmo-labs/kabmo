/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * How each language indents a new line, for the questions its parser cannot
 * answer.
 *
 * The code surface parses with a `StreamLanguage` (`stream-modes.ts`), and a
 * legacy stream mode may ship its own `indent()`. Measured against
 * `@codemirror/legacy-modes` 6.5.5: **34 of the 48 mode-backed ids answer
 * `getIndentation`** for a "block just opened" snippet, 14 answer nothing, and 12
 * ids have no mode at all.
 *
 * ## Two independent halves, because the two failures are independent
 *
 * `opens` answers "what indent should the NEXT line have" (Enter). `closes`
 * answers "this line IS a closer, dedent it" (`indentOnInput`). They are separate
 * fields because a mode can do one and not the other — measured on `go`, whose
 * own regexp is `/^\s([{}]|case |default\s*:)$/`: it indents correctly, and it
 * refuses to dedent `  }` because the pattern demands EXACTLY one space. A single
 * combined entry would have had to override the working half to fix the broken
 * one.
 *
 * ## The gate: an `opens` must never shadow a mode that answers
 *
 * Measured: an `indentService` returning a NUMBER overrides a mode's own answer
 * (JavaScript's 11 became 0); returning `undefined` falls through. So a language
 * whose mode answers has NO `opens`, and `indent-rules.test.ts` re-derives that
 * set from the installed modes — a mode that later grows an `indent()` fails
 * there instead of silently degrading 34 working languages. `closes` carries no
 * such constraint: it only adds the cases a mode declines.
 *
 * ## The rule is a TABLE, not a bracket counter
 *
 * A single "depth of `{[(` on the line" rule was measured and rejected: it gives
 * `yaml a:` and `markdown - item` nothing (no bracket), and over-indents
 * `const s = "{"` (a brace inside a string). Each family states its own opener in
 * one line a reader can check, and a language with no reliable textual rule
 * (`sql`, `makefile`, `properties`, `markdown`) states nothing — absence is what
 * makes `indentAfter` return `null` and leave the language alone.
 *
 * ## What this gets wrong, stated rather than hidden
 *
 * No grammar, so the rules are textual: `yaml` cannot tell a `:` inside a quoted
 * scalar from a key, `bash` cannot tell `then` inside a comment from a keyword,
 * and a `{` inside a string still opens a level. Each costs one wrong INITIAL
 * indent the user fixes with one keystroke, against no indent at all.
 */

/** Column width assumed when the caller has no `indentUnit` (the surface's default). */
export const DEFAULT_INDENT_WIDTH = 2;

/** One language's textual indent rules. Both halves are optional and independent. */
export interface IndentRule {
  /**
   * Whether this line opens a level for the lines that follow it.
   *
   * ABSENT for a language whose parser answers — presence would override it.
   */
  opens?: (text: string) => boolean;
  /**
   * A line that IS a closer — anchored at both ends, so `}x` is content rather
   * than a dedent.
   *
   * One pattern serves both `indentForCloser` and the `indentOnInput` language
   * data, which is what stops the two from disagreeing about which lines move. A
   * keyword closer (`fi`, `done`) cannot be expressed as a character set, which
   * is why this is a pattern and not a string of characters.
   */
  closes?: RegExp;
}

/** The line's leading whitespace, in columns (a tab counts as one). */
export function leadingWidth(text: string): number {
  return /^[ \t]*/.exec(text)?.[0].length ?? 0;
}

/** Ends with a bracket — the C-family shape. */
const endsWithBracket = (text: string): boolean => /[{[(\[]$/.test(text.trimEnd());

/** A single `}`, `]` or `)` on its own line. */
const BRACKET_CLOSER = /^[ \t]*[}\])]$/;

/**
 * The rules, keyed by Shiki id — the key `getLanguageFromPath` answers and the
 * surface holds.
 */
export const INDENT_RULES: Record<string, IndentRule> = {
  // ── Indentation-significant: a `key:` opens a block ──────────────────────
  // A `- item` deliberately does NOT open one: a list item's continuation sits
  // at the item's own column, not deeper. A comment opens nothing either.
  yaml: {
    opens: (text) => /:\s*$/.test(text.trimEnd()) && !/^[ \t]*#/.test(text),
  },

  // ── Brace families whose mode answers nothing ────────────────────────────
  toml: { opens: endsWithBracket, closes: BRACKET_CLOSER },
  ini: { opens: endsWithBracket, closes: BRACKET_CLOSER },
  hcl: { opens: endsWithBracket, closes: BRACKET_CLOSER },
  protobuf: { opens: endsWithBracket, closes: BRACKET_CLOSER },
  graphql: { opens: endsWithBracket, closes: BRACKET_CLOSER },
  nix: { opens: endsWithBracket, closes: BRACKET_CLOSER },
  svelte: { opens: endsWithBracket, closes: BRACKET_CLOSER },
  astro: { opens: endsWithBracket, closes: BRACKET_CLOSER },
  vue: { opens: endsWithBracket, closes: BRACKET_CLOSER },
  zig: { opens: endsWithBracket, closes: BRACKET_CLOSER },
  solidity: { opens: endsWithBracket, closes: BRACKET_CLOSER },
  php: { opens: endsWithBracket, closes: BRACKET_CLOSER },
  powershell: { opens: endsWithBracket, closes: BRACKET_CLOSER },
  perl: { opens: endsWithBracket, closes: BRACKET_CLOSER },

  // ── Keyword-delimited shell ──────────────────────────────────────────────
  bash: {
    opens: (text) => /\b(then|do|else)\s*$/.test(text.trimEnd()),
    closes: /^[ \t]*(fi|done|esac|\})$/,
  },

  // ── Expression languages whose blocks are layout, not brackets ────────────
  haskell: { opens: (text) => /(=|\bwhere|\bdo|\bof|\bthen|\belse)\s*$/.test(text.trimEnd()) },
  ocaml: { opens: (text) => /(=|\bdo|\bthen|\belse|\bin|\bwith)\s*$/.test(text.trimEnd()) },

  // ── Continuation by trailing backslash ───────────────────────────────────
  dockerfile: { opens: (text) => /\\$/.test(text.trimEnd()) },

  // ── Markup: an unclosed, non-self-closing tag opens a level ───────────────
  html: {
    opens: (text) => {
      const line = text.trimEnd();
      return /<[a-zA-Z][^<>]*>$/.test(line) && !/\/>$/.test(line);
    },
    closes: /^[ \t]*<\//,
  },

  // ── Deliberately flat ────────────────────────────────────────────────────
  // `sql` (clauses are keywords with no terminator), `makefile` (a recipe is a
  // TAB, not a level), `properties` (flat), `markdown` (a continuation sits at
  // the item's column), `diff` (hunk bodies are flat), `text` (nothing).
  sql: { opens: () => false },
  makefile: { opens: () => false },
  properties: { opens: () => false },
  markdown: { opens: () => false },
  diff: { opens: () => false },
  text: { opens: () => false },

  // ── Mode answers Enter, but its own closer pattern is too strict ──────────
  // `go`'s mode regexp is `/^\s([{}]|case |default\s*:)$/` — it demands EXACTLY
  // one space of indentation, so `  }` never matches and never dedents. These
  // entries add the CLOSER half only; their `opens` stays absent on purpose.
  go: { closes: BRACKET_CLOSER },
  tsx: { closes: BRACKET_CLOSER },
  jsx: { closes: BRACKET_CLOSER },
};

/** Whether this language has any rule at all. */
export function hasIndentRule(language: string): boolean {
  const rule = INDENT_RULES[language];
  return rule !== undefined && (rule.opens !== undefined || rule.closes !== undefined);
}

/**
 * The indent for the line AFTER `previousText` — what Enter asks.
 *
 * `null` when the language has no `opens` rule, so the caller can fall through to
 * the parser (or to no indent at all).
 */
export function indentAfter(language: string, previousText: string, unit = DEFAULT_INDENT_WIDTH): number | null {
  const opens = INDENT_RULES[language]?.opens;
  if (!opens) return null;
  const own = leadingWidth(previousText);
  return opens(previousText) ? own + unit : own;
}

/**
 * The indent a line that IS a closer should have — what `indentOnInput` asks.
 *
 * `null` when the language has no closer rule, or when this line is not one: a
 * `}` at the start of a YAML line is text, and moving it would edit the user's
 * content.
 */
export function indentForCloser(language: string, lineText: string, unit = DEFAULT_INDENT_WIDTH): number | null {
  const closes = INDENT_RULES[language]?.closes;
  if (!closes?.test(lineText)) return null;
  return Math.max(0, leadingWidth(lineText) - unit);
}

/**
 * The `indentOnInput` pattern for a language, or `null`.
 *
 * It is the rule's OWN `closes`, not a derived character class: measured, a
 * generic bracket pattern turned `a:\n  }` into `a:\n}` in YAML, moving content
 * the user never asked to move. And a keyword closer cannot be a character set at
 * all, so the two halves share one pattern instead of approximating it.
 */
export function indentOnInputPattern(language: string): RegExp | null {
  return INDENT_RULES[language]?.closes ?? null;
}
