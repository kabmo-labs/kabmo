/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The BRANCH hints a pending chat carries in the URL, and the rule that they
 * never outlive the chat they describe.
 *
 * `?forkFrom=` / `?forkAt=` / `?parentSessionId=` are a reload twin of the
 * pending store entry, not chat-navigation state: they answer "what does THIS
 * draft branch from". Left in the URL when the URL starts naming a different
 * chat, they are read back as that chat's own branch — measured as: press Fork,
 * leave it, press New Session, and the new chat opened with the source
 * transcript still filled above its composer, because `usePendingBranch` fell
 * back to the stale `forkFrom`. That is why every navigation that is not
 * deliberately opening a branch clears all three in one place.
 */

/** Drop every branch hint, keeping the rest of the query intact. */
export function clearBranchParams(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete('parentSessionId');
  next.delete('forkFrom');
  next.delete('forkAt');
  return next;
}

/**
 * The query a chat opened in a KNOWN context is started with: a workspace's own
 * `+`, a worktree chat, a child, a fork — the id, the folder it will run in, and
 * no branch hints. A new chat is top-level unless the call that opened it names
 * a branch, and that call sets its hints itself.
 *
 * The sidebar's primary New Session does NOT use this: it opens the landing on
 * a clean URL, because nothing has been chosen there yet.
 */
export function newSessionParams(
  prev: URLSearchParams,
  pendingId: string,
  folderId: number | string | null,
): URLSearchParams {
  const next = clearBranchParams(prev);
  next.set('sessionId', pendingId);
  if (folderId != null) next.set('folderId', String(folderId));
  else next.delete('folderId');
  return next;
}
