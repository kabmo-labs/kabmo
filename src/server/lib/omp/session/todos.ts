/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Read one session's todo state from its transcript.
 *
 * The list is omp's, and its only durable home is the session JSONL — there is
 * no separate todo file and no Kabmo-side copy to fall out of date. So the
 * read is: locate the session file, parse it, and take the deepest committed
 * snapshot on the active branch (`latestTodoSnapshot`).
 *
 * Two properties of this read are deliberate:
 *
 *   - **It is a full-file parse, cached by size+mtime.** Measured on real
 *     sessions (7.2 MB / 1905 entries) a full parse is ~15 ms, and the todos
 *     may sit megabytes from EOF — a `todo` call near the start of a long
 *     session stays the live list for the rest of it, so a bounded tail window
 *     would report "no todos" for exactly the sessions that have the most. omp
 *     flushes each entry as it appends, so the topic sees a new list within the
 *     second it was written.
 *   - **It never creates an omp process.** The session is read-only here; a
 *     panel that spawned a child per read would fight the chat's own session
 *     wrapper for the same session file.
 */

import { findSessionFileById } from '@/server/lib/omp/session/locator';
import { parseJsonlLenient } from '@/shared/lib/omp/session/jsonl';
import { latestTodoSnapshot, todoProgress } from '@/shared/lib/chat/todo/snapshot';
import type { SessionTodoState } from '@/shared/types/todo';

/** Sessions larger than this are refused rather than parsed; a transcript past
 *  it is pathological, and the read runs behind an HTTP request. */
const MAX_TODO_SESSION_BYTES = 512 * 1024 * 1024;

interface TodoCacheEntry {
  size: number;
  mtimeMs: number;
  state: SessionTodoState;
}

/**
 * Cache keyed by session id. Hangs off `globalThis` for the same reason the
 * session-file caches do: a `bun --hot` reload re-evaluates modules but keeps
 * `globalThis`, and a cache that vanished on every edit would re-parse a
 * multi-megabyte file per read during development.
 */
interface TodoCacheHost {
  entries: Map<string, TodoCacheEntry>;
}

declare global {
  // eslint-disable-next-line no-var
  var __kabmoTodoCache: TodoCacheHost | undefined;
}

function cache(): TodoCacheHost {
  globalThis.__kabmoTodoCache ??= { entries: new Map() };
  return globalThis.__kabmoTodoCache;
}

const EMPTY_TODO_STATE: SessionTodoState = { snapshot: null, progress: todoProgress([]) };

/**
 * The todo state of one session. Returns an empty state (never a throw) when
 * the transcript cannot be read: a session whose file is gone is a normal
 * condition for a sidebar entry the user has not opened yet, and the panel
 * reports "no todos" rather than an error for it.
 */
export async function readSessionTodos(sessionId: string): Promise<SessionTodoState> {
  const filePath = await findSessionFileById(sessionId);
  if (!filePath) return EMPTY_TODO_STATE;

  let size: number;
  let mtimeMs: number;
  try {
    const stats = await Bun.file(filePath).stat();
    if (stats.size > MAX_TODO_SESSION_BYTES) return EMPTY_TODO_STATE;
    size = stats.size;
    mtimeMs = stats.mtimeMs;
  } catch {
    return EMPTY_TODO_STATE;
  }

  const slot = cache().entries.get(sessionId);
  if (slot && slot.size === size && slot.mtimeMs === mtimeMs) return slot.state;

  let body: string;
  try {
    body = await Bun.file(filePath).text();
  } catch {
    return EMPTY_TODO_STATE;
  }

  const snapshot = latestTodoSnapshot(parseJsonlLenient<Record<string, unknown>>(body));
  const state: SessionTodoState = { snapshot, progress: todoProgress(snapshot?.phases ?? []) };
  cache().entries.set(sessionId, { size, mtimeMs, state });
  return state;
}
