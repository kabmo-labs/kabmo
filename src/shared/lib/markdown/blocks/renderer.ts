/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Put the block identity on the rendered markup, and nowhere else.
 *
 * The attributes go on the OUTERMOST element of each block, which is what makes
 * this compose with the wrappers `marked.ts` already emits for code blocks,
 * tables and math placeholders: the hydrators (`hydrateMermaidBlocks`,
 * `hydrateMathBlocks`, `hydrateDirectiveBlocks`) rewrite grandchildren, so a
 * reviewer's attributes on the wrapper survive every hydrate and every theme
 * repaint.
 *
 * ## Registration order is part of the contract
 *
 * `registerBlockMapper` captures the renderer as it stands. It MUST run after
 * every `marked.use({ renderer })` in `marked.ts`, or it captures the
 * un-overridden `code`/`table` and every previewed document silently loses its
 * copy buttons and its table scroller. The capture is also what keeps the
 * chat path byte-identical: a token with no tag renders exactly as before.
 */

import type { Token } from 'marked';

import { BLOCK_ATTRIBUTE, type BlockToken } from '@/shared/lib/markdown/blocks/scan';
import type { MdBlock } from '@/shared/lib/markdown/blocks/types';

/**
 * The block-level renderers that own a top-level token.
 *
 * A name missing here is a block nobody can annotate, so `registerBlockMapper`
 * refuses to register instead of skipping it: a `marked` upgrade that renames
 * one must fail loudly.
 */
export const BLOCK_RENDERERS = [
  'heading',
  'paragraph',
  'blockquote',
  'list',
  'code',
  'table',
  'html',
  'hr',
] as const;

/**
 * The BLOCK-level math extension renderers.
 *
 * `$$…$$` and `\[…\]` are blocks of the document; `$…$` and `\(…\)` are
 * inline and live inside a block that is already tagged. They are in their own
 * table because that is where marked keeps them — and because the core table
 * cannot name them at all (measured: registering `blockMathDisplay` through
 * `marked.use({ renderer })` throws "renderer does not exist").
 */
export const EXTENSION_BLOCK_RENDERERS = ['blockMath', 'blockMathDisplay'] as const;

/** The first start tag of a rendered block, after any leading whitespace. */
const LEADING_TAG = /^(\s*)<([a-zA-Z][\w-]*)/;

/** The identity attributes, or the html untouched when the token has no block. */
export function annotateBlockHtml(html: string, token: unknown): string {
  const block = (token as BlockToken | undefined)?.[BLOCK_ATTRIBUTE] as MdBlock | undefined;
  if (!block) return html;
  const attributes = `data-md-block="${block.key}" data-md-start="${block.lineStart}" data-md-end="${block.lineEnd}"`;
  return html.replace(LEADING_TAG, `$1<$2 ${attributes}`);
}

/**
 * What `registerBlockMapper` needs of the `Marked` instance.
 *
 * Deliberately structural and loosely typed: `marked`'s own `defaults.renderer`
 * is `_Renderer | null | undefined`, and the extension table is untyped in the
 * public surface. Every slot is checked at runtime before it is wrapped, so the
 * cast is the honest place to put the looseness — one module, not a `any` at
 * each call site.
 */
interface MapperHost {
  defaults: {
    renderer?: unknown;
    extensions?: { renderers?: unknown } | null;
  };
}

/** One renderer slot, already bound to the object it was read from. */
type RendererSlot = (...args: unknown[]) => string;

/** Replace a renderer slot with one that prints the block identity. */
function wrap(owner: Record<string, unknown>, name: string): void {
  const original = owner[name];
  if (typeof original !== 'function') {
    throw new Error(`marked renderer "${name}" is missing — the block map cannot be built`);
  }
  owner[name] = function blockMapper(this: unknown, token: Token, ...rest: unknown[]): string {
    const html = (original as RendererSlot).call(this, token, ...rest);
    return annotateBlockHtml(html, token);
  };
}

/**
 * Wrap every block renderer so a tagged token prints its identity.
 *
 * Mutates the instance's renderer table rather than calling `marked.use`: the
 * options form of `marked.parser` bypasses the extension renderers entirely
 * (measured — it throws on `$x^2$`), so the only safe place for this wrapper is
 * the instance's own chain.
 */
export function registerBlockMapper(instance: MapperHost): void {
  const renderer = instance.defaults.renderer as Record<string, unknown> | null | undefined;
  if (!renderer) throw new Error('marked has no renderer table — the block map cannot be built');
  for (const name of BLOCK_RENDERERS) wrap(renderer, name);

  const extensions = instance.defaults.extensions?.renderers as Record<string, unknown> | null | undefined;
  for (const name of EXTENSION_BLOCK_RENDERERS) {
    // Absent means this instance has no math extensions; skipping is correct
    // there, and the block-map test fails loudly if the names ever change.
    if (extensions && typeof extensions[name] === 'function') wrap(extensions, name);
  }
}
