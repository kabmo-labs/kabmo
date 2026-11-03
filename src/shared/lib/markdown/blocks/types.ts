/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One renderable block of a markdown document, as the RENDER produced it.
 *
 * The rendered preview has no lines and no identity: it is one HTML string.
 * A reviewer, though, points at a paragraph — so every top-level block carries
 * a key derived from its own text, and the source line range it came from.
 *
 * The key is content-derived on purpose: a line number would re-attach a note
 * to whatever moved into that line after the next edit, while an anchor that
 * names the block follows the block when text above it is inserted, deleted or
 * reflowed (see `anchor.ts`).
 */
export interface MdBlock {
  /** `type:hash#occurrence` — stable across edits above the block. */
  key: string;
  /** The marked token type (`heading`, `paragraph`, `code`, …). */
  type: string;
  /** 1-based first source line of the block. Display data, never identity. */
  lineStart: number;
  /** 1-based last source line of the block. */
  lineEnd: number;
  /** The block's text, whitespace-collapsed, truncated for display and prompt. */
  quote: string;
}

/** A judgement on one block. Two answers, because a review is a decision. */
export type BlockVerdict = 'good' | 'needs-work';

/** A stored judgement, as the server holds it and the preview paints it. */
export interface DocumentAnnotation {
  id: string;
  /** `<resolvedRoot>\0<repo>` — what makes two workspaces two documents. */
  scope: string;
  /** Workspace-relative path of the document. */
  path: string;
  /** The block this judgement belongs to (see {@link MdBlock.key}). */
  blockKey: string;
  /** The block's line range when it was judged; updated on re-save. */
  lineStart: number;
  lineEnd: number;
  verdict: BlockVerdict;
  note: string;
  /** The block's text when it was judged — what an outdated mark still shows. */
  quote: string;
  createdAt: number;
  updatedAt: number;
}

/** What a save sends: everything but the id and the timestamps. */
export type AnnotationDraft = Omit<DocumentAnnotation, 'id' | 'createdAt' | 'updatedAt'>;

/** The document a review belongs to, as the client asks for it. */
export interface ReviewTarget {
  path: string;
  root?: string | null;
  repo?: string | null;
}
