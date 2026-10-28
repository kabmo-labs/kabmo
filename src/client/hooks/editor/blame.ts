/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The editor's blame controller: one read per open file, and one history read
 * per line the reader asks about.
 *
 * ## The identity is STABLE, and the state is read through it
 *
 * The controller is handed to a CodeMirror extension, which is built once per
 * document state. A controller that changed identity per render would have to
 * be threaded through a compartment reconfigure on every keystroke — and a
 * reconfigure rebuilds the plugin, closing the panel the reader has open. So
 * the controller is built once and exposes `snapshot()` / `subscribe()`; the
 * component re-renders from the same subscription, and the surface reads the
 * same answer without either of them owning it.
 *
 * ## Three guards, each a bug first
 *
 * - **A LATE answer for another file is dropped** (a sequence number). The
 *   panel re-renders on a tab switch while the previous file's read is in
 *   flight, and adopting it would label the new file with the old authors.
 * - **A payload is only reported for the key it was read for.** The snapshot
 *   carries its own key, so the frame between a tab switch and its read shows
 *   `idle` rather than the previous file's blame.
 * - **A DIRTY buffer keeps the last payload but marks it stale.** The bytes on
 *   disk and the bytes on screen are different documents, so every line number
 *   after an edit may name the wrong line. The surface hides the labels and the
 *   panel says so; discarding the payload instead would flash the panel back to
 *   a skeleton on every keystroke.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

import type { BlameHistoryEntry, BlamePayload } from '@/shared/lib/fs/git-blame';
import type { FileEditorTarget } from '@/client/hooks/editor/file-editor-types';

export type BlameStatus = 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';

export interface BlameSnapshot {
  status: BlameStatus;
  payload: BlamePayload | null;
  message: string | null;
}

export interface BlameHistoryResult {
  entries: BlameHistoryEntry[];
  truncated: boolean;
}

export interface FileBlame {
  /** Read the file's blame unless it is already known or in flight. */
  ensure(): void;
  /** Forget the answer and read it again (the panel's Try again). */
  reload(): void;
  /** The commits that touched `line`, newest first. Cached per line. */
  history(line: number): Promise<BlameHistoryResult>;
  /** The answer for the file on screen now; `idle` while a read is in flight. */
  snapshot(): BlameSnapshot;
  /** True while the buffer holds bytes the blame does not describe. */
  stale(): boolean;
  /** Fires when the answer, its staleness or the file changes. */
  subscribe(listener: () => void): () => void;
}

const IDLE: BlameSnapshot = { status: 'idle', payload: null, message: null };

/** The request's own identity: two workspaces can hold the same relative path. */
function scopeKey(target: FileEditorTarget | null): string {
  if (!target?.path) return '';
  return `${target.root ?? ''}\u0000${target.repo ?? ''}\u0000${target.path}`;
}

export function useFileBlame(
  target: FileEditorTarget | null,
  options: { enabled?: boolean; dirty?: boolean } = {},
): FileBlame {
  const enabled = options.enabled !== false && Boolean(target?.path) && target?.deviceFile !== true;
  const dirty = options.dirty === true;
  const key = scopeKey(target);

  const [snapshot, setSnapshot] = useState<{ key: string; value: BlameSnapshot }>({ key: '', value: IDLE });

  const targetRef = useRef(target);
  targetRef.current = target;
  const keyRef = useRef(key);
  keyRef.current = key;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  /** The request sequence, so a late answer for another file is dropped. */
  const seqRef = useRef(0);
  /** The key of the read in flight, so `ensure` cannot start a second one. */
  const inflightRef = useRef('');
  const historyRef = useRef<Map<number, BlameHistoryResult>>(new Map());
  const listenersRef = useRef(new Set<() => void>());

  const load = useCallback(async (): Promise<void> => {
    const file = targetRef.current;
    if (!file?.path) return;
    const forKey = scopeKey(file);
    const seq = ++seqRef.current;
    inflightRef.current = forKey;
    setSnapshot((prev) => ({
      key: forKey,
      // The previous payload stays while a refresh runs: a reload should not
      // blank the panel it is refreshing.
      value: { status: 'loading', payload: prev.key === forKey ? prev.value.payload : null, message: null },
    }));

    const params = new URLSearchParams({ blame: '1', file: file.path, repo: file.repo || '.' });
    if (file.root) params.set('root', file.root);
    try {
      const response = await fetch(`/api/fs/git?${params.toString()}`);
      const data = (await response.json().catch(() => null)) as (BlamePayload & { error?: string }) | null;
      if (seq !== seqRef.current) return;
      if (!response.ok || !data) {
        setSnapshot({
          key: forKey,
          value: {
            status: 'error',
            payload: null,
            message: data?.error ?? `Blame request failed (HTTP ${response.status})`,
          },
        });
        return;
      }
      setSnapshot({
        key: forKey,
        value: data.available
          ? { status: 'ready', payload: data, message: null }
          : { status: 'unavailable', payload: data, message: data.message ?? null },
      });
    } catch (error: unknown) {
      if (seq !== seqRef.current) return;
      setSnapshot({
        key: forKey,
        value: { status: 'error', payload: null, message: error instanceof Error ? error.message : 'Blame failed' },
      });
    } finally {
      if (inflightRef.current === forKey) inflightRef.current = '';
    }
  }, []);

  const readHistory = useCallback(async (line: number): Promise<BlameHistoryResult> => {
    const cached = historyRef.current.get(line);
    if (cached) return cached;
    const file = targetRef.current;
    if (!file?.path) return { entries: [], truncated: false };
    const params = new URLSearchParams({
      blameHistory: '1',
      file: file.path,
      line: String(line),
      repo: file.repo || '.',
    });
    if (file.root) params.set('root', file.root);
    try {
      const response = await fetch(`/api/fs/git?${params.toString()}`);
      const data = (await response.json().catch(() => null)) as Partial<BlameHistoryResult> | null;
      const result: BlameHistoryResult = {
        entries: Array.isArray(data?.entries) ? data.entries : [],
        truncated: data?.truncated === true,
      };
      historyRef.current.set(line, result);
      return result;
    } catch {
      // A failed history read is an empty list, not a broken panel: the blame
      // above it is already the answer to "who touched this line last".
      return { entries: [], truncated: false };
    }
  }, []);

  const controllerRef = useRef<FileBlame | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = {
      ensure: () => {
        if (!enabledRef.current || dirtyRef.current) return;
        const current = snapshotRef.current;
        if (current.key === keyRef.current && current.value.status !== 'idle') return;
        if (inflightRef.current === keyRef.current) return;
        void load();
      },
      reload: () => {
        historyRef.current.clear();
        void load();
      },
      history: readHistory,
      snapshot: () => {
        const current = snapshotRef.current;
        return current.key === keyRef.current ? current.value : IDLE;
      },
      stale: () => dirtyRef.current,
      subscribe: (listener) => {
        listenersRef.current.add(listener);
        return () => {
          listenersRef.current.delete(listener);
        };
      },
    };
  }

  // Read on mount and after every save: a dirty buffer has no blame to show,
  // and the save is what makes one exist again.
  useEffect(() => {
    if (!enabled || dirty || !key) return;
    historyRef.current.clear();
    void load();
  }, [enabled, dirty, key, load]);

  // One notification per real change. `dirty` is compared rather than depended
  // on, because it moves on every keystroke and the listeners only care when it
  // FLIPS.
  const lastDirty = useRef(dirty);
  useEffect(() => {
    if (lastDirty.current === dirty) return;
    lastDirty.current = dirty;
    for (const listener of listenersRef.current) listener();
  }, [dirty]);

  useEffect(() => {
    for (const listener of listenersRef.current) listener();
  }, [snapshot]);

  const controller = controllerRef.current;
  return controller;
}
