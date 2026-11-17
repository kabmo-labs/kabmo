/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * How many ids one batch request may carry, and how a larger selection is split.
 *
 * The bound is a request guard, not a product limit: the sidebar lets a user
 * select every row it lists, and "select all" over an imported history is
 * routinely hundreds. Before this module the client sent the whole selection in
 * one body and the server answered `400 At most 500 sessions can be deleted at
 * once.` — a selection the UI itself made was refused by the API behind it.
 *
 * One number, imported by both sides: the route enforces it, the client chunks
 * by it. A second copy of `500` would let the client outgrow the route again.
 */

/** Sessions per delete/archive request. */
export const SESSION_BATCH_LIMIT = 500;

/** Workspaces per batch request. A workspace removal also rewrites the roots. */
export const WORKSPACE_BATCH_LIMIT = 200;

/**
 * Split an id list into request-sized chunks, in order.
 *
 * An empty selection yields no chunks — callers must not send an empty request,
 * which the routes refuse as a malformed body.
 */
export function chunkIds(ids: readonly string[], limit: number): string[][] {
  // A zero or negative step would loop forever; the limits above are constants,
  // so this only fires on a future caller's arithmetic mistake.
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error(`chunkIds needs a positive integer limit, got ${limit}`);
  }
  const chunks: string[][] = [];
  for (let start = 0; start < ids.length; start += limit) {
    chunks.push(ids.slice(start, start + limit));
  }
  return chunks;
}
