/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Select one session, as clicking its row does.
 *
 * The app's only routing state is `?sessionId=`, written through the same
 * `pushState` the sidebar uses. A caller that set the URL itself would bypass the
 * search-param store every mounted component reads, and the sidebar would keep
 * showing the previous selection — which is why this is one function rather than
 * the same four lines at each call site.
 *
 * `subagent` is dropped: a notification is about a session, and landing inside a
 * subagent view of a SESSION would hide the transcript the notification named.
 */

export function openSessionInUrl(sessionId: string): boolean {
  if (typeof window === 'undefined') return false;
  const id = sessionId.trim();
  if (!id) return false;

  const url = new URL(window.location.href);
  url.searchParams.set('sessionId', id);
  url.searchParams.delete('subagent');
  window.history.pushState(null, '', url);
  // `pushState` does not fire `popstate`, so the search-param store has to be
  // told; otherwise only a reload would show the new selection. A plain Event is
  // enough — the store re-reads `location.search`, which pushState already moved
  // — and it avoids depending on a constructor some environments lack.
  window.dispatchEvent(new Event('popstate'));
  return true;
}
