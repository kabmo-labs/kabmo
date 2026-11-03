/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The four math extensions, split out of `marked.ts` for the per-file ceiling —
 * and because they are the one part of the pipeline with rules that do not fit
 * in a renderer override: each is a tokenizer plus a renderer, registered
 * through `marked.use({ extensions })`.
 *
 * ## The placeholder is never the formula
 *
 * KaTeX is ~522 kB of JS worth fetching only when a message contains math, so
 * this module emits a span carrying the source and the display flag; `katex.ts`
 * swaps it for real markup once the library lands.
 *
 * ## The prose-escape flag is shared state, and that is deliberate
 *
 * `renderMarkdown` escapes HTML in prose before marked sees it, so a tokenizer
 * captures `x &lt; y` rather than `x < y` — and KaTeX would report a syntax
 * error for a perfectly good formula. The flag is set for the duration of one
 * synchronous `parse`, which is why `setProseEscaped` exists instead of a
 * parameter threaded through four renderers. `marked.parse` never awaits, so no
 * nested render can observe it mid-parse.
 */

import type { TokenizerAndRendererExtension } from 'marked';

import { MATH_PENDING_CLASS } from '@/shared/lib/markdown/katex';

/**
 * True while `renderMarkdown` parses prose it escaped itself, read by the math
 * renderers below.
 */
let proseEscaped = false;

/** Set for the duration of one parse; always paired with `false`. */
export function setProseEscaped(value: boolean): void {
  proseEscaped = value;
}

interface TokenLike {
  type: string;
  text?: string;
  raw?: string;
}

/**
 * Emit a math placeholder instead of rendering KaTeX inline.
 *
 * Two things happen to the captured source, and both exist because this is the
 * one place all four math extensions funnel through:
 *
 * 1. **Entities are reversed** when the prose was escaped. Only the three
 *    entities that escaper emits are reversed, and only when it ran — a document
 *    (`allowHtml`) whose own text legitimately holds `&amp;` is left alone.
 * 2. **The result is percent-encoded**, the way a mermaid block carries its
 *    source. HTML-escaping the payload instead re-escapes what step 1 just
 *    restored, and the attribute round-trip hides the extra layer from both
 *    ends. An encoded payload holds no HTML-special character, so nothing
 *    between here and injection can alter it.
 */
export function renderMathPlaceholder(tex: string, displayMode: boolean): string {
  const restored = proseEscaped
    ? tex.replace(/&(amp|lt|gt);/g, (_, name: string) => (name === 'amp' ? '&' : name === 'lt' ? '<' : '>'))
    : tex;
  const display = displayMode ? ' data-math-display="1"' : '';
  const span = `<span class="${MATH_PENDING_CLASS}" data-math="${encodeURIComponent(restored)}"${display}></span>`;
  // Block math must stay inside a block element: DOMPurify drops a bare
  // `<span>` that sits at the top level of the fragment, which silently deleted
  // every `$$…$$` formula. KaTeX's own output is inline-level too, so the old
  // synchronous renderer relied on the same wrapper being present.
  return displayMode ? `<p>${span}</p>` : span;
}

/** The four extensions, in the order `marked.ts` registers them. */
export function mathExtensions(): TokenizerAndRendererExtension[] {
  return [
    // \( ... \) inline math
    {
      name: 'inlineMath',
      level: 'inline',
      start(src: string) {
        return src.match(/\\\(/)?.index;
      },
      tokenizer(src: string) {
        const match = /^\\\(([\s\S]+?)\\\)/.exec(src);
        return match
          ? { type: 'inlineMath', raw: match[0], text: match[1] }
          : undefined;
      },
      renderer(token: TokenLike) {
        return renderMathPlaceholder(token.text ?? '', false);
      },
    },
    // \[ ... \] block math
    {
      name: 'blockMath',
      level: 'block',
      start(src: string) {
        return src.match(/^\\\[/)?.index;
      },
      tokenizer(src: string) {
        const match = /^\\\[([\s\S]+?)\\\]/.exec(src);
        return match
          ? { type: 'blockMath', raw: match[0], text: match[1] }
          : undefined;
      },
      renderer(token: TokenLike) {
        return renderMathPlaceholder(token.text ?? '', true);
      },
    },
    // $$ ... $$ display math (block-level, must be its own line)
    {
      name: 'blockMathDisplay',
      level: 'block',
      start(src: string) {
        return src.match(/^\$\$/)?.index;
      },
      tokenizer(src: string) {
        const match = /^\$\$([\s\S]+?)\$\$(?:\n|$)/.exec(src);
        return match
          ? { type: 'blockMathDisplay', raw: match[0], text: match[1] }
          : undefined;
      },
      renderer(token: TokenLike) {
        return renderMathPlaceholder(token.text ?? '', true);
      },
    },
    // $ ... $ inline math. The flanking rules are the whole defence: a single
    // `$` is the one delimiter that collides with ordinary text, and this
    // pipeline renders shell output, currency, SQL and awk programs all day.
    //
    //   opening $  — not preceded by a word char (checked in `start`, the only
    //                place the preceding character is visible), and not
    //                followed by a digit, `$` or `{`. The digit guard is what
    //                makes `$5`, `$1` and `$10` text; `{` keeps `${HOME}` out.
    //   closing $  — not preceded by whitespace, and not followed by a WORD
    //                char or `$`. That trailing guard is load-bearing twice
    //                over: it rejects `PATH=$PATH:$HOME` (closer followed by
    //                `H`) and `a$b$c` (followed by `c`), and it is the reason
    //                the rule no longer depends on where `start` happened to
    //                land — the tokenizer is anchored at `^` and cannot see
    //                the preceding character, so `a$b$c` was math while
    //                `ax$b$c` was text on the identical rule.
    //
    // `$n$ = 3` and `$x^2$ benar` still parse: a space after the closer is not
    // a word char.
    {
      name: 'inlineMathDollar',
      level: 'inline',
      start(src: string) {
        const match = /(^|[^\w$])\$(?!\$)(?!\s)/.exec(src);
        return match ? match.index + (match[1]?.length ?? 0) : undefined;
      },
      tokenizer(src: string) {
        const match = /^\$(?![\d${])((?:\\\$|[^$])*?)(?<!\s)\$(?![\w$])/.exec(src);
        return match
          ? { type: 'inlineMathDollar', raw: match[0], text: match[1] }
          : undefined;
      },
      renderer(token: TokenLike) {
        return renderMathPlaceholder(token.text ?? '', false);
      },
    },
  ];
}
