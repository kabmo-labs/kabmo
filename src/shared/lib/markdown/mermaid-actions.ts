/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The floating actions every mermaid block carries: copy the source, and
 * re-render the diagram.
 *
 * Shared by the marked placeholder (`marked.ts`) and the hydrated block
 * (`mermaid.ts`) because `applySvg` REPLACES the placeholder's innerHTML — a
 * second copy of this markup is how the refresh button would exist before the
 * first render and disappear after it, which is exactly when a blank diagram
 * needs it.
 *
 * The refresh button is `data-mermaid-refresh`: the delegated click listener
 * in `MarkdownRenderer` reads it, so no component handler is needed. It must
 * stay a separate button from `data-copy` — the copy branch returns early on
 * an empty `data-copy`, and a refresh that fell through to it would copy the
 * empty string and drop the click.
 */

const COPY_ICON =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

const REFRESH_ICON =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/></svg>';

/** Both action buttons for a block whose source is `source`. */
export function mermaidActionsHtml(source: string): string {
  const copyAttr = source.replace(/"/g, '&quot;');
  return (
    `<button type="button" class="code-copy-float" data-copy="${copyAttr}" aria-label="Copy diagram source" title="Copy diagram source">${COPY_ICON}</button>` +
    `<button type="button" class="code-copy-float mermaid-refresh-float" data-mermaid-refresh aria-label="Refresh diagram" title="Refresh diagram">${REFRESH_ICON}</button>`
  );
}

/** The pending/error body: the raw source, hidden while a render is in flight. */
export function mermaidSourceHtml(source: string): string {
  const escaped = source
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<pre><code class="language-mermaid">${escaped}</code></pre>`;
}
