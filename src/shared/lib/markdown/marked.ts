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
import { mathExtensions, setProseEscaped } from '@/shared/lib/markdown/math-extensions';
import { registerBlockMapper } from '@/shared/lib/markdown/blocks/renderer';
import { mapBlocks } from '@/shared/lib/markdown/blocks/scan';
import type { MdBlock } from '@/shared/lib/markdown/blocks/types';

/** Escape HTML for safe interpolation inside highlighted output. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
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

marked.use({ extensions: mathExtensions() });

// LAST, and the order is the contract: the mapper captures these renderers as
// they stand, so registering it before the overrides above would capture the
// un-wrapped `code`/`table` and every previewed document would lose its copy
// buttons and its table scroller. A math block's token is not in this table at
// all (it belongs to the extension), which is why the mapper also wraps
// `defaults.extensions.renderers` — see `blocks/renderer.ts`.
registerBlockMapper(marked);

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
 * The healed source both entry points parse — one spelling of the pipeline, so
 * the preview and the mapped preview can never disagree about what a document
 * says.
 */
function heal(markdown: string, allowHtml: boolean): string {
  const source = allowHtml ? markdown : escapeHtmlOutsideCode(markdown);
  return remend(source, { katex: true, inlineKatex: false })
    .replace(INCOMPLETE_LINK_RE, (_, text: string) => `<span class="md-incomplete-link">${text}</span>`);
}

/**
 * Heal streaming markdown (remend) then parse to HTML via marked.
 * Synchronous and side-effect free — safe in both server loaders and the
 * browser. The output must be sanitized with DOMPurify before injection.
 */
export function renderMarkdown(markdown: string, options: RenderMarkdownOptions = {}): string {
  const healed = heal(markdown, options.allowHtml === true);
  // The math renderers need to know the prose was escaped, so they can hand
  // KaTeX the source the author wrote instead of `x &lt; y`. `marked.parse`
  // never awaits, so no nested render can observe this mid-parse.
  setProseEscaped(options.allowHtml !== true);
  try {
    return (marked.parse(healed) as string).trim();
  } finally {
    setProseEscaped(false);
  }
}

/** The mapped render: the same HTML, plus the block each element came from. */
export interface MappedMarkdown {
  html: string;
  blocks: MdBlock[];
}

/**
 * Render a document AND say which source block each rendered element is.
 *
 * The preview needs the second half: a reviewer points at a paragraph, and a
 * line number cannot express that (the render has no lines). The identity rides
 * on `data-md-block`, a content-derived anchor, so it survives an edit above the
 * block — see `blocks/anchor.ts`.
 *
 * Deliberately NOT `marked.parse(healed)`: that lexes a second time and the
 * fresh tokens carry no tag. One lexer pass, then `parser(tokens)` on those
 * objects. The attributes are a strict no-op for an untagged token, so the
 * chat path (`renderMarkdown`) stays byte-identical.
 */
export function renderMappedMarkdown(markdown: string, options: RenderMarkdownOptions = {}): MappedMarkdown {
  const healed = heal(markdown, options.allowHtml === true);
  const { tokens, blocks } = mapBlocks(marked, healed);
  setProseEscaped(options.allowHtml !== true);
  try {
    const html = (marked.parser(tokens) as string).trim();
    return { html, blocks };
  } finally {
    setProseEscaped(false);
  }
}

export { marked };
