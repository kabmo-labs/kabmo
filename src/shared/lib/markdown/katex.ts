/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Demand-driven KaTeX rendering.
 *
 * `katex` is ~522 kB of JS that only matters when a message actually contains
 * math. Importing it statically from `marked.ts` put it in the *synchronous*
 * bundle: every page load paid for it, whether or not a single formula was ever
 * displayed.
 *
 * The pipeline keeps its synchronous shape by emitting a placeholder instead:
 * `marked.ts` renders `<span class="math-pending" data-math="…">` during parse,
 * and this module swaps those placeholders for real KaTeX markup once the
 * library lands — the same split `mermaid.ts` uses for ```mermaid fences, so
 * the two features behave identically from the renderer's point of view.
 */

import { sanitizeKatexHtml } from '@/shared/lib/markdown/sanitize';

type KatexModule = typeof import('katex');

let katexPromise: Promise<KatexModule['default'] | null> | null = null;

/** Placeholder class emitted by `marked.ts` in place of rendered math. */
export const MATH_PENDING_CLASS = 'math-pending';

/**
 * Load KaTeX once per page. Never throws: on failure the promise resolves
 * `null` and placeholders stay as visible source text, which is what the old
 * synchronous `renderKatex` fallback did for invalid LaTeX.
 */
function loadKatex(): Promise<KatexModule['default'] | null> {
  if (!katexPromise) {
    katexPromise = import('katex')
      .then((mod) => mod.default)
      .catch((error) => {
        console.error('[katex] load failed', error);
        return null;
      });
  }
  return katexPromise;
}

/**
 * Start loading KaTeX without awaiting it. Called from the renderer so the
 * library is already in flight while the rest of the message renders.
 */
export function preloadKatex(): void {
  void loadKatex();
}

/**
 * Render one placeholder element into real KaTeX markup. `displayMode` is
 * carried on the placeholder as `data-math-display` ("1" for block math).
 *
 * The generated markup is passed through DOMPurify's MathML profile before it
 * touches the DOM: `tex` is model output, so although KaTeX escapes its own
 * output, the result still crosses an innerHTML boundary and gets sanitized
 * like every other model-authored fragment in this pipeline.
 */
function renderPlaceholder(el: HTMLElement, katex: KatexModule['default']): void {
  // `marked.ts` percent-encodes the payload, the way a mermaid block carries
  // its source: the TeX must survive the HTML attribute round-trip untouched,
  // and escaping it as HTML double-encoded every formula the prose escaper had
  // already touched. A malformed payload degrades to the raw attribute.
  const encoded = el.dataset.math ?? '';
  let tex = encoded;
  try {
    tex = decodeURIComponent(encoded);
  } catch {
    // Leave `tex` as the literal attribute text.
  }
  const displayMode = el.dataset.mathDisplay === '1';
  try {
    el.innerHTML = sanitizeKatexHtml(katex.renderToString(tex, { throwOnError: false, displayMode }));
    el.classList.remove(MATH_PENDING_CLASS);
    el.removeAttribute('data-math');
    el.removeAttribute('data-math-display');
  } catch {
    // Keep the source text visible rather than blanking the formula.
    el.textContent = tex;
    el.classList.remove(MATH_PENDING_CLASS);
  }
}

/**
 * Replace every pending math placeholder under `root` with KaTeX output.
 * Loads the library on demand; resolves with how many were rendered.
 */
export async function hydrateMathBlocks(root: ParentNode): Promise<{ rendered: number; failed: number }> {
  const pending = [...root.querySelectorAll<HTMLElement>(`.${MATH_PENDING_CLASS}`)];
  if (pending.length === 0) return { rendered: 0, failed: 0 };

  const katex = await loadKatex();
  if (!katex) return { rendered: 0, failed: pending.length };

  let rendered = 0;
  for (const el of pending) {
    // A streaming re-render may have replaced the node while awaiting.
    if (!el.isConnected) continue;
    renderPlaceholder(el, katex);
    rendered += 1;
  }
  return { rendered, failed: 0 };
}

/** Sanitize KaTeX-generated markup (kept here so callers need one import). */
export { sanitizeKatexHtml };
