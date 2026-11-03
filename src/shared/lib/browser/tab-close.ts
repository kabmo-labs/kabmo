/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What "close this tab" MEANS for the agent's browser, decided once.
 *
 * A session's omp agent routinely opens several pages in the project-shared
 * Chromium, and a finished tab keeps costing the panel: the viewer attaches to
 * the newest owned target, so every stale tab is one more reason the panel
 * shows the wrong page, and it keeps its renderer alive in the daemon.
 *
 * Two rules live here because both the route and the panel need them and a
 * second copy would drift:
 *
 * - **Only the session's OWN tabs are closable.** The daemon is project-shared,
 *   so a target id from another session must be refused by name rather than
 *   attempted (`pickTargetId`/`ownedPages` already scope the view this way).
 * - **`Target.closeTarget` is the whole close.** Measured on Chromium 1248
 *   against a tab that is mid-screencast: it answers `{"success":true}`, the
 *   browser socket STAYS OPEN, the attached session dies on its own
 *   (`Page.stopScreencast` then answers "Session with given id not found" and
 *   `Target.detachedFromTarget` arrives browser-level), and the remaining tabs
 *   are still attachable. So the viewer needs no special teardown — but it does
 *   need to know the page it was watching is gone, which the 1s target poll
 *   already covers.
 */

/** The tab id the client asks to close, or null when it is not a usable id. */
export function readCloseTarget(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const targetId = value.trim();
  // A CDP target id is an opaque hex string; anything with whitespace or a
  // path separator is a caller bug, not a tab.
  if (!targetId || targetId.length > 128) return null;
  if (/[\s/\\:]/.test(targetId)) return null;
  return targetId;
}

export interface CloseVerdict {
  ok: boolean;
  /** Present when `ok` is false: why the tab was not closed. */
  reason?: string;
  /** Tabs that survive the close, in registry order. */
  remaining: string[];
}

/**
 * Decide whether `targetId` may be closed, given what this session owns.
 *
 * `ownedIds` is the on-disk registry read, so a tab another session opened is
 * not merely "not listed here" — it is refused, and the refusal names the
 * ownership rule so a client bug does not look like a browser failure.
 */
export function closeVerdict(targetId: string, ownedIds: readonly string[]): CloseVerdict {
  const remaining = ownedIds.filter((id) => id !== targetId);
  if (!ownedIds.includes(targetId)) {
    return { ok: false, reason: 'That tab does not belong to this session', remaining: [...ownedIds] };
  }
  return { ok: true, remaining };
}

/**
 * Which tab the panel should watch after `closed` is gone: the neighbour to its
 * RIGHT in registry order (the newest remaining owned tab), else the one to its
 * left, else nothing.
 *
 * Deliberately not "always the newest": the registry is in creation order, so
 * after closing one of several tabs the user is looking at, staying put in that
 * region is what keeps the panel on the page they were watching.
 */
export function neighbourTargetId(ownedIds: readonly string[], closed: string): string | null {
  const index = ownedIds.indexOf(closed);
  if (index === -1) return null;
  return ownedIds[index + 1] ?? ownedIds[index - 1] ?? null;
}
