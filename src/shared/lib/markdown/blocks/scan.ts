/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Turn a markdown source into the blocks a rendered preview will contain, and
 * tag each token so the renderer can put that identity on the markup.
 *
 * The line ranges come from `raw`, and that is exact rather than approximate:
 * `marked`'s top-level tokens partition the source verbatim, so accumulating
 * `raw.split('\n').length - 1` per token — including the `space` tokens — names
 * the real line every block starts on (measured on this repo's own documents;
 * see the block-map tests).
 *
 * ## The tokens are returned because they ARE the render input
 *
 * Annotating the token objects and then calling `marked.parse(source)` does
 * nothing: `parse` lexes again, and the fresh tokens carry no tag. The only
 * shape that works is one lexer pass, then `parser(tokens)` on those objects.
 *
 * ## `space` and `def` are not blocks
 *
 * `space` is the gap between blocks (it carries lines, never content), and a
 * definition token renders nothing at all. Both are walked for their lines and
 * dropped from the result, so a review can never be attached to whitespace.
 */

import type { Token } from 'marked';

import { blockKeyOf, quoteOf } from '@/shared/lib/markdown/blocks/anchor';
import type { MdBlock } from '@/shared/lib/markdown/blocks/types';

/** Where the map is written onto the token, read by `renderer.ts`. */
export const BLOCK_ATTRIBUTE = '__mdBlock';

/** A token carrying its block, once `mapBlocks` has run. */
export type BlockToken = Token & { [BLOCK_ATTRIBUTE]?: MdBlock };

/**
 * The lexer surface `mapBlocks` needs — the `Marked` instance satisfies it.
 *
 * Called as a METHOD, never destructured: `marked.lexer` reads `this.defaults`,
 * so `const { lexer } = marked; lexer(source)` throws `this.defaults` undefined.
 */
export interface BlockLexer {
  lexer(source: string): Token[];
}

export interface BlockScan {
  /** The same tokens, each block-level one tagged with its {@link MdBlock}. */
  tokens: Token[];
  blocks: MdBlock[];
}

/** Token types that occupy lines but render no block of their own. */
const NOT_A_BLOCK: Record<string, true> = { space: true, def: true };

function linesIn(raw: string): number {
  return raw.split('\n').length - 1;
}

/**
 * Lex `source` and tag every block token with its key and line range.
 *
 * The returned tokens MUST be handed to `marked.parser`. Rendering the source
 * again would lex a second time and lose every tag.
 */
export function mapBlocks(instance: BlockLexer, source: string): BlockScan {
  const tokens = instance.lexer(source);
  const blocks: MdBlock[] = [];
  const seen = new Map<string, number>();
  let line = 1;

  for (const token of tokens) {
    const raw = typeof token.raw === 'string' ? token.raw : '';
    if (NOT_A_BLOCK[token.type] === true) {
      line += linesIn(raw);
      continue;
    }
    // A trailing newline is the SEPARATOR between blocks, not part of the last
    // line of this one — counting it would report a block as one line longer
    // than the text it renders.
    const body = raw.replace(/\n+$/, '');
    const lineStart = line;
    const lineEnd = lineStart + linesIn(body);
    const block: MdBlock = {
      key: blockKeyOf(token.type, raw, seen),
      type: token.type,
      lineStart,
      lineEnd,
      quote: quoteOf(body),
    };
    blocks.push(block);
    (token as BlockToken)[BLOCK_ATTRIBUTE] = block;
    line += linesIn(raw);
  }

  return { tokens, blocks };
}
