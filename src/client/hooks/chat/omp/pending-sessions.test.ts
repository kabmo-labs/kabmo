/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
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
  hydratePendingSession,
  listPendingSessions,
  markPendingSessionSent,
  MAX_UNSENT_DRAFTS,
  PENDING_SETTLE_MS,
  reconcilePendingSessions,
  releasePendingSession,
  startPendingSession,
  withPendingRows,
} from '@/client/hooks/chat/omp/pending-sessions';
import { formatNewSessionTitle } from '@/shared/lib/omp/session/default-title';
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

/** Drop whatever the previous case left, without exporting a test-only reset. */
function clear(): void {
  for (const entry of listPendingSessions()) releasePendingSession(entry.id);
}

beforeEach(clear);

describe('a new chat keeps its sidebar row', () => {
  test('the row is drawn for an id the structure does not carry', () => {
    const id = startPendingSession(1);
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
    const id = startPendingSession(1);
    markPendingSessionSent(id);
    // The user clicks another session: the pending chat is no longer the URL's.
    reconcilePendingSessions({ listed: new Set(), running: new Set() });
    expect(state()).toEqual({ [id]: expect.any(Number) });
  });

  test('an UNSENT draft keeps its row too, so the draft stays reachable', () => {
    // The reported bug: the row was derived from `?sessionId=`, so switching
    // sessions deleted a chat the user had just opened — and with it the only
    // way back to the draft stored under that id.
    const id = startPendingSession(1);
    reconcilePendingSessions({ listed: new Set(), running: new Set() });
    expect(state()).toEqual({ [id]: null });
  });

  test('repeated New Session clicks do not accumulate rows', () => {
    const ids = [1, 2, 3, 4, 5].map(() => startPendingSession(1));
    const kept = listPendingSessions().map((entry) => entry.id);
    expect(kept).toEqual(ids.slice(-MAX_UNSENT_DRAFTS));
    // A SENT entry is never the one evicted: its transcript is on the way.
    const sent = kept[0];
    expect(sent).toBeDefined();
    markPendingSessionSent(sent as string);
    startPendingSession(1);
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
    const id = startPendingSession(1);
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
    const id = startPendingSession(1);
    markPendingSessionSent(id);
    reconcilePendingSessions({ listed: new Set([id]), running: new Set([id]) });
    expect(state()).toEqual({});
  });
});

describe('a spawn moves the row onto the id omp answered with', () => {
  test('the entry follows the id, keeping its folder and its clock', () => {
    const pending = startPendingSession(2);
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
});

describe('withPendingRows', () => {
  test('routes the row to the folder the chat was started in', () => {
    const id = startPendingSession(2);
    const out = withPendingRows(twoFolders(), listPendingSessions(), { activeId: id });

    expect(out[1]?.sessions?.[0]?.id).toBe(id);
    expect(out[0]?.sessions).toEqual([]);
  });

  test('falls back to the folder owning the session on screen', () => {
    const id = startPendingSession(null);
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
    const id = startPendingSession(1);
    expect(withPendingRows(base, [{ id: 'real-1', folderId: 1, createdAt: Date.now(), sentAt: null }], {
      activeId: id,
    })).toBe(base);
  });

  test('the row is named by the sent text, else by the id clock', () => {
    const id = startPendingSession(1);
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
