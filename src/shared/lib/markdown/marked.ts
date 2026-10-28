/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Configured marked-based markdown → HTML pipeline.
 *
 * Stack (run in order, all server/client safe — parsed synchronously):
 *   1. remend  — heal incomplete markdown while streaming (before parse)
 *   2. marked  — GFM true, breaks true, autolink via linkify-it (CJK
 *      punctuation is not swallowed into URLs, and a match carrying a backtick
 *      is left to the code-span rule — see autolink.ts), plus a KaTeX
 *      extension for \(...\) inline, \[...\] block, $$...$$ display and
 *      $...$ inline math
 *
 * remend heals BLOCK math (`$$…$$`) only. Its inline healer must stay off
 * (`inlineKatex: false`): it closes an unmatched `$` by appending one to the
 * END OF THE TEXT, so any message with an odd `$` count — every lone `$HOME`,
 * `$PATH`, `$1` — became one giant formula from that `$` to the end of the
 * message, and a `$` landing on a closing ``` fence swallowed the rest of the
 * document into that code block. `$…$` is left to marked's own flanking rules.
 *
 * The resulting HTML is NOT sanitized here — run the output through
 * DOMPurify (see sanitize.ts) before injecting. What the source's own HTML
 * means is the caller's call: `renderMarkdown` escapes it (assistant output,
 * where markup is data) unless `allowHtml` says the source is a document.
 */

import { Marked, Renderer, type Tokens } from 'marked';
import { codeSafeAutolink } from '@/shared/lib/markdown/autolink';
import remend from 'remend';
import { highlightCode } from '@/shared/lib/code/syntax-highlight';
import { directiveBlockHtml, isDirectiveLanguage, parseDirectiveAttributes } from '@/shared/lib/markdown/directives';
import { MATH_PENDING_CLASS } from '@/shared/lib/markdown/katex';

/** Escape HTML for safe interpolation inside highlighted output. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * True while `renderMarkdown` parses prose it escaped itself. Set around the
 * `marked.parse` call, read by `renderMathPlaceholder`. Synchronous by
 * construction: `marked.parse` never awaits, so no nested `renderMarkdown`
 * can observe the flag mid-parse.
 */
let proseEscaped = false;

/**
 * Emit a math placeholder instead of rendering KaTeX inline.
 *
 * `katex` is ~522 kB of JS worth loading only when a message contains math, so
 * it is not imported here. The placeholder carries the TeX source and the
 * display flag; `katex.ts` swaps it for real markup once the library lands
 * (see `hydrateMathBlocks`).
 *
 * Two things happen to the captured source here, and both exist because this
 * renderer is the one place all four math extensions funnel through:
 *
 * 1. **Entities are reversed** when `renderMarkdown` escaped the prose itself
 *    (`proseEscaped`). `escapeHtmlOutsideCode` rewrites the source BEFORE
 *    marked sees it, so a tokenizer captures `x &lt; y` rather than `x < y` and
 *    KaTeX reports a syntax error for a perfectly good formula. Only the three
 *    entities that escaper emits are reversed, and only when it ran — a
 *    document (`allowHtml`) whose own text legitimately holds `&amp;` is left
 *    alone.
 * 2. **The result is percent-encoded**, the way a mermaid block carries its
 *    source. HTML-escaping the payload instead re-escapes what step 1 just
 *    restored, and the attribute round-trip hides the extra layer from both
 *    ends. An encoded payload holds no HTML-special character, so nothing
 *    between here and `renderPlaceholder` can alter it.
 */
function renderMathPlaceholder(tex: string, displayMode: boolean): string {
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

interface TokenLike {
  type: string;
  text?: string;
  raw?: string;
}

const marked = new Marked({
  gfm: true,
  breaks: true,
});

marked.use(codeSafeAutolink());

/**
 * Class of the scroll container `marked` puts around every table (styled by
 * `.prose-content .md-table-scroll` in `tailwind.css`). Exported so the
 * renderer and the CSS cannot drift apart unobserved.
 */
export const TABLE_SCROLL_CLASS = 'md-table-scroll';

interface CodeToken {
  type: string;
  text?: string;
  lang?: string;
  raw?: string;
}

// Wrap fenced code blocks with a floating copy button (top-right, inside the
// block). The delegated click listener in MarkdownRenderer handles the copy
// via the data-copy attribute — no React handler needed.
function codeBlockShell(code: string, bodyHtml: string): string {
  const copyAttr = code.replace(/"/g, '&quot;');
  return `<div class="code-block">
  <button type="button" class="code-copy-float" data-copy="${copyAttr}" aria-label="Copy code">
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
  </button>
  ${bodyHtml}
</div>\n`;
}

// ```mermaid fences become a placeholder hydrated to SVG by mermaid.ts.
function mermaidBlockRenderer(code: string): string {
  const body = `<pre><code class="language-mermaid">${escapeHtml(code)}</code></pre>`;
  const shell = codeBlockShell(code, body);
  return `<div class="mermaid-block" data-mermaid="${encodeURIComponent(code)}" data-mermaid-state="pending">${shell}</div>`;
}

function codeBlockRenderer(token: CodeToken): string {
  const info = token.lang?.trim() || 'text';
  const code = token.text ?? '';
  if (info === 'mermaid') {
    return mermaidBlockRenderer(code);
  }
  // A namespace-qualified token (`omp:chart`) is a plugin directive. The
  // ordinary code block is still produced — and stays INSIDE the placeholder —
  // so a fence no plugin claims renders exactly as it did before the slot
  // existed. `info` may carry `key=\"value\"` pairs after the token.
  const [lang = 'text'] = info.split(/\s+/, 1);
  const highlighted = lang === 'text' ? escapeHtml(code) : highlightCode(code, lang);
  const block = codeBlockShell(code, `<pre><code class="language-${lang}">${highlighted}</code></pre>`);
  if (!isDirectiveLanguage(lang)) return block;
  return directiveBlockHtml(lang, parseDirectiveAttributes(info.slice(lang.length)), block);
}

/** The base table renderer, captured before the override below replaces it: the
 *  wrapper must not re-implement marked's own `<table>`/`<thead>` output. */
const renderTable = Renderer.prototype.table;

marked.use({
  renderer: {
    code(this: unknown, token: CodeToken) {
      // Fenced/block code (``` ... ``` or indented) gets the wrapper; inline
      // backtick code is single-line and stays plain. Distinguish by the raw
      // marker: fenced begins with backticks, inline has no newline.
      const isFenced = Boolean(token.raw && /^```/.test(token.raw));
      if (isFenced || (token.text ?? '').includes('\n')) {
        return codeBlockRenderer(token);
      }
      return `<code class="inline-code">${escapeHtml(token.text ?? '')}</code>`;
    },
    // Inline backtick code uses the `codespan` token (not `code`) in marked
    // v18 — render it with the same styled inline-code class.
    codespan(this: unknown, token: CodeToken) {
      return `<code class="inline-code">${escapeHtml(token.text ?? '')}</code>`;
    },
    /**
     * A GFM table is the one block with no wrapping rule: an auto-layout table
     * is sized to `max(100%, the sum of its columns' min-content widths)`, so a
     * table holding long unbreakable tokens (paths, hashes, URLs) lands WIDER
     * than its box — and the chat timeline's scroller is `overflow-x-hidden`, so
     * its right columns were clipped outright on desktop and phone alike. Every
     * table gets its own scroll container: `width: 100%` while it fits, scrolls
     * itself when it does not. Delegating to the base renderer keeps marked's
     * own output (cell alignment, escaping) the authority inside the wrapper.
     */
    table(this: Renderer, token: Tokens.Table): string {
      return `<div class="${TABLE_SCROLL_CLASS}">${renderTable.call(this, token)}</div>`;
    },
  },
});

marked.use({
  extensions: [
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
  ],
});

/** Escape HTML special chars in text, leaving backtick-delimited code intact
 *  (inline `code` and fenced ``` blocks) so code like `a < b` is not mangled
 *  by double-escaping. */
function escapeHtmlOutsideCode(source: string): string {
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return source
    .split('`')
    .map((part, i) => (i % 2 === 1 ? part : escape(part)))
    .join('`');
}

/** remend heals a streaming-incomplete `[text](url` into
 * `[text](streamdown:incomplete-link)`. Swap it for a dimmed span before
 * parsing so the placeholder URL never leaks into the DOM as an href. */
const INCOMPLETE_LINK_RE = /\[([^\]]*)\]\(streamdown:incomplete-link\)/g;

export interface RenderMarkdownOptions {
  /**
   * Leave the source's own HTML markup intact so marked parses it as markup.
   *
   * OFF (default) is the agent-output contract: assistant HTML is data, never
   * markup, so `<div align="center">` and `<br>` arrive as visible text and
   * DOMPurify is only the second line of defence. ON is the file-preview
   * contract, where the source IS the document — a README's `<p align="center">`
   * block, badge `<img>` and inline `<br>` are the layout its author wrote, and
   * escaping them shows the tags instead of the page. DOMPurify still sanitizes
   * the result, so scripts and event handlers never survive either way.
   */
  allowHtml?: boolean;
}

/**
 * Heal streaming markdown (remend) then parse to HTML via marked.
 * Synchronous and side-effect free — safe in both server loaders and the
 * browser. The output must be sanitized with DOMPurify before injection.
 */
export function renderMarkdown(markdown: string, options: RenderMarkdownOptions = {}): string {
  const source = options.allowHtml ? markdown : escapeHtmlOutsideCode(markdown);
  const healed = remend(source, { katex: true, inlineKatex: false })
    .replace(INCOMPLETE_LINK_RE, (_, text: string) => `<span class="md-incomplete-link">${text}</span>`);
  // The math renderers need to know the prose was escaped, so they can hand
  // KaTeX the source the author wrote instead of `x &lt; y`. `marked.parse`
  // never awaits, so no nested render can observe this mid-parse.
  proseEscaped = !options.allowHtml;
  try {
    return (marked.parse(healed) as string).trim();
  } finally {
    proseEscaped = false;
  }
}

export { marked };
