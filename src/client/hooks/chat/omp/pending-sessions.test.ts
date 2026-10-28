/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The sidebar's pending rows.
 *
 * Every case here is a way a brand-new chat used to vanish from the sidebar:
 * switching away from it (the row was derived from `?sessionId=`, so it left
 * with the URL), a phone that never drew it at all (only the desktop sidebar
 * asked for the placeholder), and the `new-…` → omp-UUID switch a spawn makes
 * (the row's id changed under a list that had no entry for the new one). The
 * remaining cases pin the two bounds that keep the store from becoming a
 * graveyard: an authoritative row always wins, and a draft the user walked away
 * from without sending is not a row.
 */

import { beforeEach, describe, expect, test } from 'bun:test';

import {
  adoptPendingSession,
  consumeAdoption,
  isSpawnAdoption,
  hydratePendingSession,
  listPendingSessions,
  markPendingSessionSent,
  MAX_UNSENT_DRAFTS,
  PENDING_SETTLE_MS,
  reconcilePendingSessions,
  releasePendingSession,
  startPendingSession,
} from '@/client/hooks/chat/omp/pending-sessions';
import { pendingHostFolderIds, withPendingRows } from '@/client/hooks/chat/omp/pending-rows';
import { formatNewSessionTitle } from '@/shared/lib/omp/session/default-title';
import { forgetSession, getSessionValue, setSessionKey } from '@/shared/lib/workspace/session-state/store';
import { CHAT_DRAFT_KEY } from '@/shared/lib/chat/composer/draft';
import type { WorkspaceFolderData } from '@/shared/types';

/** One folder holding the given session ids. */
function folders(...ids: string[]): WorkspaceFolderData[] {
  return [{
    id: 1,
    name: 'ws',
    isExpanded: false,
    hasMore: false,
    totalSessions: ids.length,
    sessions: ids.map((id) => ({ id, folder_id: 1, title: id.toUpperCase() })),
  }];
}

/** Two folders, so a pending row can be routed to the right one. */
function twoFolders(): WorkspaceFolderData[] {
  return [
    { id: 1, name: 'one', isExpanded: false, hasMore: false, totalSessions: 0, sessions: [] },
    { id: 2, name: 'two', isExpanded: false, hasMore: false, totalSessions: 0, sessions: [] },
  ];
}

/** Every entry currently held, as `id → sentAt`. */
function state(): Record<string, number | null> {
  return Object.fromEntries(listPendingSessions().map((entry) => [entry.id, entry.sentAt]));
}

/** Ids this case minted. The id is `new-<epochMs>`, and a released entry lets
 *  the next case in the same millisecond mint the SAME one — so teardown has to
 *  know what to forget rather than trusting the live entry list. */
const touched = new Set<string>();

/** `startPendingSession`, recorded for teardown. */
function start(folderId: number | string | null): string {
  const id = startPendingSession(folderId);
  touched.add(id);
  return id;
}

/** Drop whatever the previous case left, without exporting a test-only reset.
 *  The session-state entries go too: whether a chat still holds a draft is what
 *  decides if its row survives, so a leaked draft would keep a row alive. */
function clear(): void {
  for (const entry of listPendingSessions()) releasePendingSession(entry.id);
  for (const id of touched) forgetSession(id);
  touched.clear();
}

beforeEach(clear);

describe('a new chat keeps its sidebar row', () => {
  test('the row is drawn for an id the structure does not carry', () => {
    const id = start(1);
    const out = withPendingRows(folders('real-1'), [{ id, folderId: 1, createdAt: Date.now(), sentAt: null }], {
      activeId: id,
    });

    expect(out[0]?.sessions?.[0]?.id).toBe(id);
    // The row is the newest activity in its folder, so it leads — the order the
    // server payload already uses.
    expect(out[0]?.sessions?.[1]?.id).toBe('real-1');
    // And its folder opens, or the row would exist off screen.
    expect(out[0]?.isExpanded).toBe(true);
  });

  test('a SENT chat survives switching to another session', () => {
    const id = start(1);
    markPendingSessionSent(id);
    // The user clicks another session: the pending chat is no longer the URL's.
    reconcilePendingSessions({ listed: new Set(), running: new Set() });
    expect(state()).toEqual({ [id]: expect.any(Number) });
  });

  test('a chat the user TYPED into keeps its row, so the draft stays reachable', () => {
    // The reported bug this rule exists for: the row was derived from
    // `?sessionId=`, so switching sessions deleted a chat the user had just
    // opened — and with it the only way back to the draft stored under that id.
    const id = start(1);
    setSessionKey(id, CHAT_DRAFT_KEY, 'perbaiki tombol kirim');
    reconcilePendingSessions({ listed: new Set(), running: new Set() });
    expect(state()).toEqual({ [id]: null });
  });

  test('a chat opened and left EMPTY loses its row on the switch', () => {
    // The other half of the same rule, and the reported "new session yang tidak
    // dikirim tidak hilang": an unconditional row made every stray New Session
    // click a permanent sidebar entry with nothing behind it. The draft slot is
    // the difference — `chat.draft` is what the composer writes, and a blank one
    // is the negative answer.
    const id = start(1);
    setSessionKey(id, CHAT_DRAFT_KEY, '');
    reconcilePendingSessions({ listed: new Set(), running: new Set() });
    expect(state()).toEqual({});
  });

  test('an attachment alone is a draft too', () => {
    const id = start(1);
    setSessionKey(id, CHAT_DRAFT_KEY, '   ');
    setSessionKey(id, 'chat.draftAttachments', [{ id: 'a', name: 'shot.png' }]);
    reconcilePendingSessions({ listed: new Set(), running: new Set() });
    expect(state()).toEqual({ [id]: null });
  });

  test('the OPEN chat keeps its row whatever its draft holds', () => {
    // The row the user is looking at is never dropped by this pass: a new chat
    // whose composer is empty is exactly the state on screen after the click.
    const id = start(1);
    setSessionKey(id, CHAT_DRAFT_KEY, '');
    reconcilePendingSessions({ listed: new Set(), running: new Set(), activeId: id });
    expect(state()).toEqual({ [id]: null });

    // And leaving it is what retires the row.
    reconcilePendingSessions({ listed: new Set(), running: new Set(), activeId: 'other' });
    expect(state()).toEqual({});
  });

  test('a draft that has not been READ yet keeps its row', () => {
    // No session-state entry at all: the blob is still in flight, so "empty" is
    // unknown rather than true. Dropping the row here would lose the way back to
    // a draft that does exist — the same shape as the reload case.
    const id = start(1);
    expect(getSessionValue(id, CHAT_DRAFT_KEY)).toBeUndefined();
    reconcilePendingSessions({ listed: new Set(), running: new Set(), activeId: 'other' });
    expect(state()).toEqual({ [id]: null });
  });

  test('repeated New Session clicks do not accumulate rows', () => {
    const ids = [1, 2, 3, 4, 5].map(() => start(1));
    const kept = listPendingSessions().map((entry) => entry.id);
    expect(kept).toEqual(ids.slice(-MAX_UNSENT_DRAFTS));
    // A SENT entry is never the one evicted: its transcript is on the way.
    const sent = kept[0];
    expect(sent).toBeDefined();
    markPendingSessionSent(sent as string);
    start(1);
    expect(listPendingSessions().map((entry) => entry.id)).toContain(sent as string);
  });

  test('a live run holds the row wherever the user navigates', () => {
    // A reloaded mid-run chat: the URL is not its id, but the status map says
    // its run is in flight, and a spinner without its row is the bug.
    hydratePendingSession('omp-running', 1, true);
    reconcilePendingSessions({ listed: new Set(), running: new Set(['omp-running']) });
    expect(state()).toEqual({ 'omp-running': expect.any(Number) });
  });

  test('a sent row whose transcript never arrived is released after the grace', () => {
    const id = start(1);
    markPendingSessionSent(id);
    adoptPendingSession(id, 'omp-never-writes', 1);
    const entry = listPendingSessions()[0];
    expect(entry?.id).toBe('omp-never-writes');
    expect(entry?.sentAt).toBeNumber();

    // Inside the grace the row holds: the transcript omp buffers is seconds
    // away, and dropping the row now is the bug this store exists to fix.
    reconcilePendingSessions({
      listed: new Set(),
      running: new Set(),
      now: (entry?.sentAt ?? 0) + PENDING_SETTLE_MS,
    });
    expect(state()).toEqual({ 'omp-never-writes': expect.any(Number) });

    // Past it the row goes: a child that died before writing a transcript
    // cannot leave a row behind for the life of the tab.
    reconcilePendingSessions({
      listed: new Set(),
      running: new Set(),
      now: (entry?.sentAt ?? 0) + PENDING_SETTLE_MS + 1,
    });
    expect(state()).toEqual({});
  });

  test('an authoritative row supersedes the pending one, whatever its state', () => {
    const id = start(1);
    markPendingSessionSent(id);
    reconcilePendingSessions({ listed: new Set([id]), running: new Set([id]) });
    expect(state()).toEqual({});
  });
});

describe('a spawn moves the row onto the id omp answered with', () => {
  test('the entry follows the id, keeping its folder and its clock', () => {
    const pending = start(2);
    markPendingSessionSent(pending);
    const before = listPendingSessions()[0];

    adoptPendingSession(pending, 'omp-1', 2);

    expect(state()).toEqual({ 'omp-1': expect.any(Number) });
    expect(listPendingSessions()[0]?.folderId).toBe(2);
    // The creation clock is carried, not re-derived: a new stamp would move the
    // row's title seconds and re-rank its folder mid-run.
    expect(listPendingSessions()[0]?.createdAt).toBe(before?.createdAt);
  });

  test('an unknown source still registers the spawned id', () => {
    // A send with no `?sessionId=` at all: the spawned session is exactly as
    // unscanned as a clicked one, so it needs the row just the same.
    adoptPendingSession(null, 'omp-2', 1);
    expect(state()).toEqual({ 'omp-2': expect.any(Number) });
  });

  test('only a real adoption is claimable, and only once', () => {
    // The session-state provider carries the transient slot's UI state onto an
    // adopted id. Clicking away from a pending chat is the SAME transition from
    // the URL's point of view, so the provider must ask here first — otherwise
    // the pending chat's draft is copied into the session the user clicked
    // (measured: a POST for that session carrying `chat.draft`).
    const pending = start(2);
    adoptPendingSession(pending, 'omp-3', 2);
    expect(consumeAdoption(pending, 'omp-3')).toBe(true);
    // One adoption is claimed once: a second look is a plain switch.
    expect(consumeAdoption(pending, 'omp-3')).toBe(false);
    // And an unrelated pair never claims anything.
    expect(consumeAdoption(pending, 'omp-4')).toBe(false);
  });

  test('a peek identifies an adoption without spending the claim', () => {
    // The agent hook asks "is this the SAME conversation under a new id" so it
    // can keep the run's tool-call bookkeeping. It must not consume the record,
    // or the session-state provider — which owns the single claim — would then
    // refuse to migrate the pending slot's UI state.
    const pending = start(2);
    adoptPendingSession(pending, 'omp-5', 2);
    expect(isSpawnAdoption(pending, 'omp-5')).toBe(true);
    expect(isSpawnAdoption(pending, 'omp-5')).toBe(true);
    // Clicking another session is not an adoption, from either side.
    expect(isSpawnAdoption(pending, 'omp-6')).toBe(false);
    expect(isSpawnAdoption(null, 'omp-5')).toBe(false);
    // …and the claim is still there for the provider.
    expect(consumeAdoption(pending, 'omp-5')).toBe(true);
  });
});

describe('withPendingRows', () => {
  test('routes the row to the folder the chat was started in', () => {
    const id = start(2);
    const out = withPendingRows(twoFolders(), listPendingSessions(), { activeId: id });

    expect(out[1]?.sessions?.[0]?.id).toBe(id);
    expect(out[0]?.sessions).toEqual([]);
  });

  test('falls back to the folder owning the session on screen', () => {
    const id = start(null);
    const out = withPendingRows(twoFolders(), listPendingSessions(), { activeId: id });
    // Nothing owns it, and no URL pick: the first folder hosts the row rather
    // than dropping it, because a row the user cannot see is not a row.
    expect(out[0]?.sessions?.[0]?.id).toBe(id);
  });

  test('returns the SAME array when there is nothing to add', () => {
    const base = folders('real-1');
    expect(withPendingRows(base, [], { activeId: null })).toBe(base);
    // And when the structure already carries the session: the row is the real
    // one, so injecting a second copy is what would make the item blink.
    const id = start(1);
    expect(withPendingRows(base, [{ id: 'real-1', folderId: 1, createdAt: Date.now(), sentAt: null }], {
      activeId: id,
    })).toBe(base);
  });

  test('the auto-expand host is the folder the row is DRAWN in', () => {
    // The sidebar opens the folder it is about to hide a row in, so the id it
    // opens must come from the same resolution the row is placed by — never a
    // second guess.
    const id = start(2);
    const entries = listPendingSessions();
    const placed = withPendingRows(twoFolders(), entries, { activeId: id });
    const hosted = pendingHostFolderIds(twoFolders(), entries, { activeId: id });

    expect(placed[1]?.sessions?.[0]?.id).toBe(id);
    expect(hosted).toEqual(['2']);
    // No entries: nothing to open, and the list is not touched.
    expect(pendingHostFolderIds(twoFolders(), [], { activeId: id })).toEqual([]);
  });

  test('the row is named by the sent text, else by the id clock', () => {
    const id = start(1);
    const entry = listPendingSessions()[0];
    expect(entry).toBeDefined();
    const hinted = withPendingRows(folders(), listPendingSessions(), { activeId: id, titleFor: () => 'Perbaiki tombol' });
    expect(hinted[0]?.sessions?.[0]?.title).toBe('Perbaiki tombol');

    const plain = withPendingRows(folders(), listPendingSessions(), { activeId: id });
    // The stamp is the id's own epoch, so the title does not churn on a
    // revalidate the way a `new Date()` fallback made it.
    expect(plain[0]?.sessions?.[0]?.title).toBe(formatNewSessionTitle(new Date(Number(id.slice(4)))));
    expect(plain[0]?.sessions?.[0]?.updated_at).toBe(new Date(Number(id.slice(4))).toISOString());
  });
});
