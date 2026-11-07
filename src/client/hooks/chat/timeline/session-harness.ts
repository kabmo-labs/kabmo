/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The open chat's harness, and whether the composer may change it.
 *
 * Three sources, in one order, and the order is the whole contract:
 *
 *  1. the SIDEBAR ROW — what a spawned chat runs on, read from the row the
 *     client already has rather than from a new endpoint, because a second
 *     source would be a second answer to "which agent runs this chat";
 *  2. the SPAWN RECORD (`spawn-harness.ts`) — the row lags a fresh spawn by one
 *     folder read, and this covers that window without inventing a value;
 *  3. the PICK made on a chat that has not spawned yet.
 *
 * The pick used to live only in a ref, and the pending chat's composer was
 * never handed `harness` / `onSelectHarness` at all. So the tab strip moved —
 * `ModelDropdown` keeps its own `viewHarness` — while `pendingHarnessRef` stayed
 * null and the server's `new.ts` fell back to `omp-rpc`: the reported "I sent
 * with the opencode harness but it was processed by omp". A pick therefore has
 * to be BOTH written for the send path (the ref) and rendered (this state).
 *
 * `editable` is false as soon as the chat has a transcript or a sidebar row:
 * harness is a SPAWN property, so changing it under a conversation would
 * silently switch the frame source for turns another agent produced.
 */

import { useCallback, useMemo } from 'preact/hooks';
import { useSyncExternalStore } from 'preact/compat';
import type { WorkspaceFolderData } from '@/shared/types';
import { spawnedHarnessFor } from '@/client/hooks/chat/timeline/spawn-harness';

/**
 * The PICK made on a chat that has not spawned yet, keyed by chat id.
 *
 * A map rather than component state for the same reason `spawn-harness.ts` is
 * one: the pick is written by the composer (the tab strip) and read by surfaces
 * that are not its ancestor — the mode toggles, through this hook's resolver.
 * With the pick in `useState` inside `useSessionHarness`, only the picker saw
 * it: a pending `claude` chat still offered Goal, and arming it did nothing
 * because the spawn path forwards `plan` only (measured in a browser).
 *
 * Keyed by chat id rather than cleared in an effect, so a render can never
 * observe the previous chat's pick: a different pending chat is a different
 * choice.
 */
const pickedHarness = new Map<string, string>();
const pickListeners = new Set<() => void>();

/** Record a pick. The picker's own ref write is the caller's business. */
export function setHarnessPick(sessionId: string | null, harness: string): void {
  if (!sessionId) return;
  pickedHarness.set(sessionId, harness);
  for (const listener of [...pickListeners]) listener();
}

/** The pick recorded for this chat, or undefined for a chat nobody picked on. */
export function harnessPickFor(sessionId: string | null | undefined): string | undefined {
  return sessionId ? pickedHarness.get(sessionId) : undefined;
}

/** Test seam: a fresh app must not inherit the previous one's picks. */
export function resetHarnessPicks(): void {
  pickedHarness.clear();
}

/** The pick, live: what the tab strip shows and what the spawn will send. */
export function useHarnessPick(sessionId: string | null): string | undefined {
  return useSyncExternalStore(
    (listener: () => void) => {
      pickListeners.add(listener);
      return () => {
        pickListeners.delete(listener);
      };
    },
    () => harnessPickFor(sessionId),
  );
}

/**
 * The harness that owns a chat, from the three sources in one order — and the
 * order is the whole contract:
 *
 *  1. the SIDEBAR ROW — what a spawned chat runs on, read from the row the
 *     client already has rather than from a new endpoint, because a second
 *     source would be a second answer to "which agent runs this chat";
 *  2. the SPAWN RECORD (`spawn-harness.ts`) — the row lags a fresh spawn by one
 *     folder read, and this covers that window without inventing a value;
 *  3. the PICK made on a chat that has not spawned yet.
 *
 * Exported so every reader resolves it the SAME way. The timeline hook used to
 * resolve it a second time from the first two sources only, which is how the
 * pick stopped reaching the mode toggles.
 */
export function resolveSessionHarness(
  folders: WorkspaceFolderData[],
  sessionId: string | null,
  picked: string | undefined,
): { harness: string | undefined; fromRow: boolean } {
  if (!sessionId) return { harness: undefined, fromRow: false };
  for (const folder of folders) {
    for (const entry of folder.sessions ?? []) {
      if (entry.id === sessionId) return { harness: entry.harness, fromRow: true };
    }
  }
  return { harness: spawnedHarnessFor(sessionId) ?? picked, fromRow: false };
}

export interface SessionHarness {
  /** The harness that owns the open chat, or undefined before it was picked. */
  harness: string | undefined;
  /** False once the chat has messages or a sidebar row: switching needs a new chat. */
  editable: boolean;
  /** Records a pick. On a chat that has not spawned the spawn reads it; there
   *  is no live session to re-target. */
  pick: (next: string) => void;
  /**
   * The same three facts as the composer's props, so the pending chat's
   * composer and the spawned chat's take ONE slice. They are two branches of
   * `chat-timeline/index.tsx`, and a branch that forgot one of them is exactly
   * how the harness pick stopped reaching the spawn.
   */
  picker: {
    harness?: string;
    harnessEditable: boolean;
    onSelectHarness: (next: string) => void;
  };
}

export function useSessionHarness(
  folders: WorkspaceFolderData[],
  sessionId: string | null,
  messageCount: number,
  pendingHarnessRef: { current: string | null },
): SessionHarness {
  const pickedForThisChat = useHarnessPick(sessionId);
  const resolved = useMemo(
    () => resolveSessionHarness(folders, sessionId, pickedForThisChat),
    [folders, sessionId, pickedForThisChat],
  );

  const pick = useCallback((next: string) => {
    // The ref is what the SEND path reads; the store is what every renderer
    // reads. A pick that moved only one of them is the reported defect.
    pendingHarnessRef.current = next;
    setHarnessPick(sessionId, next);
  }, [pendingHarnessRef, sessionId]);

  // A pick is only meaningful before the chat has a row: once the sidebar names
  // its harness, that is the agent the chat is running on.
  const editable = messageCount === 0 && !resolved.fromRow;
  return {
    harness: resolved.harness,
    editable,
    pick,
    picker: {
      ...(resolved.harness ? { harness: resolved.harness } : {}),
      harnessEditable: editable,
      onSelectHarness: pick,
    },
  };
}
