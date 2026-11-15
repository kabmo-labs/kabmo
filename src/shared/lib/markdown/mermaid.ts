/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Async client-side hydration for ```mermaid blocks emitted by marked.ts.
 *
 * marked renders mermaid fences as `.mermaid-block[data-mermaid=<uri-encoded
 * source>]` placeholders; this module lazily imports mermaid (kept out of the
 * main bundle), renders each source to SVG, sanitizes it, and swaps the
 * placeholder in place. Parse errors fall back to the raw source so streaming
 * half-diagrams degrade to code instead of breaking the timeline.
 *
 * Rendered SVGs are cached per theme+source so a remounted block (timeline
 * scroll, re-render) is restored synchronously instead of flashing the
 * placeholder again.
 */

import { sanitizeMermaidSvg } from '@/shared/lib/markdown/sanitize';
import { mermaidActionsHtml, mermaidSourceHtml } from '@/shared/lib/markdown/mermaid-actions';
import { isDarkTheme } from '@/shared/lib/theme/catalog';

export interface MermaidRenderResult {
  rendered: number;
  failed: number;
}

type MermaidModule = typeof import('mermaid');
type ThemeKey = 'dark' | 'default';

const SVG_CACHE_LIMIT = 60;
const svgCache = new Map<string, string>();

let mermaidPromise: Promise<MermaidModule['default']> | null = null;
let lastThemeKey: ThemeKey | null = null;

function resolveThemeKey(): ThemeKey {
  return isDarkTheme(document.documentElement.dataset.theme || document.documentElement.getAttribute('data-theme')) ? 'dark' : 'default';
}

function cacheKey(themeKey: ThemeKey, source: string): string {
  return `${themeKey}\u0000${source}`;
}

function readCachedSvg(themeKey: ThemeKey, source: string): string | null {
  return svgCache.get(cacheKey(themeKey, source)) ?? null;
}

function writeCachedSvg(themeKey: ThemeKey, source: string, svg: string): void {
  if (svgCache.size >= SVG_CACHE_LIMIT) {
    const oldest = svgCache.keys().next().value;
    if (oldest !== undefined) svgCache.delete(oldest);
  }
  svgCache.set(cacheKey(themeKey, source), svg);
}

async function loadMermaid(themeKey: ThemeKey): Promise<MermaidModule['default']> {
  if (!mermaidPromise || lastThemeKey !== themeKey) {
    lastThemeKey = themeKey;
    mermaidPromise = import('mermaid')
      .then((mod) => {
        mod.default.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: themeKey,
          // Mermaid 12 defaults the global layout to `elk`, which is what pulled
          // the ~1.4 MB elkjs bundle into the client build for every diagram.
          // `dagre` ships inside mermaid's own core chunk and renders all the
          // diagram types this app sees, so pin it here and alias `elkjs` to a
          // stub in the build (`src/client/stubs/elkjs.ts`).
          layout: 'dagre',
          // On a parse/draw failure mermaid draws its own "Syntax error in text /
          // mermaid version 12.x" diagram into a temp `<div id="d<render-id>">`
          // appended to `document.body`, and throws BEFORE removing it — so every
          // failed render leaks a full-size error SVG into the page (the stray
          // bottom banner). `suppressErrorRendering` makes that path drop the temp
          // elements first; `renderBlock`'s catch already degrades the block to
          // its raw source, which is the only fallback we want.
          suppressErrorRendering: true,
          flowchart: { useMaxWidth: false, wrappingWidth: 100000 },
          sequence: { useMaxWidth: false },
        });
        return mod.default;
      })
      .catch((error) => {
        mermaidPromise = null;
        throw error;
      });
  }
  return mermaidPromise;
}

function applySvg(block: HTMLElement, svg: string, themeKey: ThemeKey): void {
  // `dataset.mermaid` is URI-encoded for the attribute; the copy button must
  // give the reader the diagram they can paste back, not its percent escape.
  const source = decodeURIComponent(block.dataset.mermaid ?? '');
  block.innerHTML = mermaidActionsHtml(source) + svg;
  block.dataset.mermaidState = 'done';
  block.dataset.mermaidTheme = themeKey;

  // Mermaid sizes the SVG from its own 16px label metrics. Cap the rendered
  // width so the effective label size lands near the app's body text instead
  // of towering over it; narrow columns still shrink the whole diagram.
  const diagram = block.querySelector<SVGSVGElement>(':scope > svg');
  const naturalWidth = Number(diagram?.getAttribute('width'));
  if (diagram && Number.isFinite(naturalWidth) && naturalWidth > 0) {
    block.style.setProperty('--mermaid-diagram-max', `${Math.round(naturalWidth * 0.8)}px`);
  }
}

let renderSeq = 0;

async function renderBlock(block: HTMLElement, cachedOnly: boolean): Promise<boolean> {
  const source = block.dataset.mermaid;
  if (source == null) return false;

  const themeKey = resolveThemeKey();
  const decoded = decodeURIComponent(source);
  const cached = readCachedSvg(themeKey, decoded);
  if (cached) {
    applySvg(block, cached, themeKey);
    return true;
  }
  if (cachedOnly) return true;

  block.dataset.mermaidState = 'rendering';
  try {
    const mermaid = await loadMermaid(themeKey);
    const { svg } = await mermaid.render(`mermaid-svg-${Date.now()}-${renderSeq++}`, decoded);
    if (!block.isConnected) return false;
    const clean = sanitizeMermaidSvg(svg);
    writeCachedSvg(themeKey, decoded, clean);
    applySvg(block, clean, themeKey);
    return true;
  } catch {
    if (block.isConnected) block.dataset.mermaidState = 'error';
    return false;
  }
}

/**
 * Render every pending `.mermaid-block` under `root`. A block whose SVG was
 * rendered for a different theme key is re-rendered here, which is how a theme
 * switch repaints diagrams; `force` re-renders even matching blocks.
 * Idempotent — blocks already rendered with the current theme are skipped
 * unless forced, and blocks mid-render are left alone. With `cachedOnly`, only
 * blocks whose SVG is already cached are restored (synchronous, no rendering) —
 * the fast path that keeps remounted blocks from flashing the placeholder.
 */
export async function hydrateMermaidBlocks(
  root: ParentNode,
  options: { force?: boolean; cachedOnly?: boolean } = {},
): Promise<MermaidRenderResult> {
  const themeKey = resolveThemeKey();
  const blocks = Array.from(root.querySelectorAll<HTMLElement>('.mermaid-block'));
  const results = await Promise.all(
    blocks.map(async (block) => {
      const state = block.dataset.mermaidState;
      const themed = block.dataset.mermaidTheme === themeKey;
      if (state === 'done' && themed && !options.force) return true;
      if (state === 'rendering') return false;
      return renderBlock(block, options.cachedOnly === true);
    }),
  );
  return { rendered: results.filter(Boolean).length, failed: results.filter((ok) => !ok).length };
}

/**
 * Re-render one block from scratch — the block's own Refresh button.
 *
 * The cached SVG is dropped first: a blank diagram is usually a cached blank
 * (or an SVG whose sanitized markup lost a node), so re-applying the cache
 * would reproduce the blank the reader just asked to fix. The block is reset
 * to its placeholder before the retry, so a failed second attempt shows the
 * source in the error colour instead of leaving the old blank SVG up.
 */
export async function refreshMermaidBlock(block: HTMLElement): Promise<void> {
  const encoded = block.dataset.mermaid;
  if (encoded == null) return;
  const source = decodeURIComponent(encoded);
  const themeKey = resolveThemeKey();
  svgCache.delete(cacheKey(themeKey, source));
  block.dataset.mermaidState = 'pending';
  delete block.dataset.mermaidTheme;
  block.innerHTML = `<div class="code-block">${mermaidActionsHtml(source)}${mermaidSourceHtml(source)}</div>`;
  await renderBlock(block, false);
}

/**
 * Handle a click that landed on a block's Refresh button.
 *
 * Returns true when the click WAS a refresh, so the caller stops there: the
 * block is also a door into the zoom/pan viewer, and letting the click fall
 * through would open a blank overlay instead of retrying the render.
 */
export function refreshMermaidFromClick(target: EventTarget | null): boolean {
  const button = (target as HTMLElement | null)?.closest?.<HTMLButtonElement>('button[data-mermaid-refresh]');
  if (!button) return false;
  const block = button.closest<HTMLElement>('.mermaid-block');
  if (block) void refreshMermaidBlock(block);
  return true;
}
