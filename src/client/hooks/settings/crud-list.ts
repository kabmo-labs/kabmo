import { useCallback, useEffect, useState } from 'preact/hooks';
import { invalidateComposerCache } from '@/shared/lib/chat/composer/client';
import type { WriteOutcome } from '@/shared/types';

export interface CrudListMessages {
  load: string;
  save: string;
  delete: string;
}

/**
 * Config bag for {@link useCrudList}. The defaults reproduce the plain
 * agent/command/skill shape (GET list → select first, POST `{ [bodyKey]: item }`
 * with optimistic upsert, DELETE `?id=` then refetch). Every override exists so
 * the MCP screen keeps its project-scoped, server-list-only behavior.
 */
export interface CrudListConfig<T extends { id: string }, D = T> {
  endpoint: string;
  listKey: string;
  bodyKey: string;
  /** Extra query string (with leading `?`) appended to GET (and refetch). */
  query?: string;
  messages: CrudListMessages;
  /** Composer cache key invalidated after a successful save/delete. */
  cacheKey?: string;
  /** Build the item to persist when creating. */
  buildNew: (draft: D) => T;
  /** Build the item to persist when updating. */
  buildUpdate: (draft: D, selected: T | undefined, selectedId: string | null) => T;
  /** Custom POST body. Defaults to `{ [bodyKey]: target }`. */
  buildBody?: (target: T) => unknown;
  /** Custom DELETE query. Defaults to `?id=${encodeURIComponent(id)}`. */
  buildDeleteQuery?: (id: string) => string;
  /** Read the list out of a payload; `null` when absent. Defaults to `data[listKey]`. */
  readList?: (data: unknown) => T[] | null;
  /** Resolve selected id after load. Defaults to the first item or `null`. */
  resolveOnLoad?: (prev: string | null, list: T[]) => string | null;
  /** Resolve selected id after save. Return `undefined` to leave it untouched. */
  resolveOnSave?: (target: T, list: T[] | null) => string | null | undefined;
  /** When true, never optimistically upsert on save. */
  serverListOnly?: boolean;
  /** When true, delete uses the response list instead of refetching. */
  deleteFromResponse?: boolean;
  /** When false, `selected` is undefined if no id matches. Defaults true. */
  fallbackToFirst?: boolean;
}

export interface CrudListController<T extends { id: string }, D = T> {
  items: T[];
  selectedId: string | null;
  selected: T | undefined;
  isCreatingNew: boolean;
  isLoading: boolean;
  /** Why the list could not be read, or null. A failed read is never an empty list. */
  loadError: string | null;
  /** Re-run the list read (after a save that the server answered differently). */
  reload: () => void;
  select: (id: string) => void;
  startCreate: () => void;
  /** Resolves with the server's answer; the caller reports it. */
  save: (draft: D) => Promise<WriteOutcome>;
  remove: (id: string) => Promise<WriteOutcome>;
}

function defaultReadList<T>(listKey: string) {
  return (data: unknown): T[] | null => {
    const value = (data as Record<string, unknown> | null | undefined)?.[listKey];
    return Array.isArray(value) ? (value as T[]) : null;
  };
}

/** The refusal sentence a payload carries, when it carries one. */
function payloadError(data: unknown): string | null {
  if (typeof data !== 'object' || data === null || !('error' in data)) return null;
  const error = data.error;
  return typeof error === 'string' && error.trim() ? error : null;
}

/** Shared load/save/delete + selection controller for the settings CRUD screens. */
export function useCrudList<T extends { id: string }, D = T>(
  config: CrudListConfig<T, D>,
): CrudListController<T, D> {
  const { endpoint, listKey, query, messages, cacheKey } = config;
  const [items, setItems] = useState<T[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadNonce, setLoadNonce] = useState(0);

  const readList = config.readList ?? defaultReadList<T>(listKey);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    fetch(`${endpoint}${query ?? ''}`)
      .then(async (res) => {
        const data: unknown = await res.json().catch(() => null);
        if (!res.ok) throw new Error(payloadError(data) ?? `GET ${endpoint} answered ${res.status}`);
        return data;
      })
      .then((data) => {
        if (!active) return;
        const list = readList(data) ?? [];
        setItems(list);
        setLoadError(null);
        setSelectedId((prev) =>
          config.resolveOnLoad ? config.resolveOnLoad(prev, list) : list.length > 0 ? list[0].id : null,
        );
      })
      .catch((err) => {
        if (!active) return;
        // Reported, never swallowed into an empty list: "no agents" and "the
        // read failed" are different facts and the panel says which it is.
        console.error(messages.load, err);
        setLoadError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [endpoint, query, loadNonce]);

  const selected =
    config.fallbackToFirst === false
      ? items.find((item) => item.id === selectedId)
      : items.find((item) => item.id === selectedId) ?? items[0];

  const reload = useCallback(() => setLoadNonce((n) => n + 1), []);

  const select = (id: string) => {
    setIsCreatingNew(false);
    setSelectedId(id);
  };

  const startCreate = () => {
    setIsCreatingNew(true);
    setSelectedId(null);
  };

  const save = async (draft: D): Promise<WriteOutcome> => {
    const target = isCreatingNew
      ? config.buildNew(draft)
      : config.buildUpdate(draft, selected, selectedId);
    const body = config.buildBody ? config.buildBody(target) : { [config.bodyKey]: target };
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data: unknown = await res.json().catch(() => null);
      const error = payloadError(data) ?? (res.ok ? null : `POST ${endpoint} answered ${res.status}`);
      if (error) {
        console.error(messages.save, error);
        return { ok: false, error };
      }
      const list = readList(data);
      if (list) {
        setItems(list);
      } else if (!config.serverListOnly) {
        setItems((prev) => {
          const exists = prev.some((item) => item.id === target.id);
          return exists
            ? prev.map((item) => (item.id === target.id ? target : item))
            : [...prev, target];
        });
      }
      const nextId = config.resolveOnSave ? config.resolveOnSave(target, list) : target.id;
      if (nextId !== undefined) setSelectedId(nextId);
      setIsCreatingNew(false);
      if (cacheKey) invalidateComposerCache(cacheKey);
      return { ok: true };
    } catch (err) {
      console.error(messages.save, err);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };

  const remove = async (id: string): Promise<WriteOutcome> => {
    const deleteQuery = config.buildDeleteQuery
      ? config.buildDeleteQuery(id)
      : `?id=${encodeURIComponent(id)}`;
    try {
      const res = await fetch(`${endpoint}${deleteQuery}`, { method: 'DELETE' });
      const data: unknown = await res.json().catch(() => null);
      const error = payloadError(data) ?? (res.ok ? null : `DELETE ${endpoint} answered ${res.status}`);
      if (error) {
        console.error(messages.delete, error);
        return { ok: false, error };
      }
      if (cacheKey) invalidateComposerCache(cacheKey);
      if (config.deleteFromResponse) {
        const list = readList(data) ?? items.filter((item) => item.id !== id);
        setItems(list);
        if (selectedId === id) setSelectedId(list[0]?.id ?? null);
      } else {
        const reloadRes = await fetch(`${endpoint}${query ?? ''}`);
        const reloadData: unknown = await reloadRes.json().catch(() => null);
        const next = readList(reloadData) ?? [];
        setItems(next);
        if (selectedId === id) setSelectedId(next[0]?.id || null);
      }
      return { ok: true };
    } catch (err) {
      console.error(messages.delete, err);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };

  return {
    items,
    selectedId,
    selected,
    isCreatingNew,
    isLoading,
    loadError,
    reload,
    select,
    startCreate,
    save,
    remove,
  };
}
