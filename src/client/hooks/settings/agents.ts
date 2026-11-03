/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Agents panel's list, over omp's own agent definition files.
 *
 * `GET /api/settings/agents` lists what `discoverNativeAgents` finds (user root
 * plus the selected workspace's `.omp/agents`), and every write posts a
 * `write`/`delete` action that lands in a markdown file — the only place omp
 * reads agents from. Each write answers with the re-read list, which is adopted
 * verbatim so the panel shows the files that exist rather than a draft that was
 * never saved.
 */

import { useCallback, useEffect, useState } from 'preact/hooks';
import type { AgentItem, WriteOutcome } from '@/shared/types';

export interface AgentsController {
  agents: AgentItem[];
  selectedId: string | null;
  selected: AgentItem | undefined;
  isLoading: boolean;
  /** Why the list could not be read, or null. */
  loadError: string | null;
  reload: () => void;
  select: (id: string) => void;
  /**
   * Write one definition. `previousFileName` is the file the open definition
   * was read from, which a rename replaces instead of leaving two copies.
   */
  save: (agent: AgentItem, previousFileName?: string | null) => Promise<WriteOutcome>;
  remove: (agent: AgentItem) => Promise<WriteOutcome>;
}

function readAgents(data: unknown): AgentItem[] | null {
  if (typeof data !== 'object' || data === null || !('agents' in data)) return null;
  return Array.isArray(data.agents) ? (data.agents as AgentItem[]) : null;
}

function readError(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null || !('error' in data)) return undefined;
  return typeof data.error === 'string' ? data.error : undefined;
}

export function useAgents(query: string): AgentsController {
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    fetch(`/api/settings/agents${query}`)
      .then(async (res) => {
        const data: unknown = await res.json().catch(() => null);
        if (!res.ok) throw new Error(readError(data) ?? `GET /api/settings/agents answered ${res.status}`);
        return data;
      })
      .then((data) => {
        if (!active) return;
        const list = readAgents(data) ?? [];
        setAgents(list);
        setLoadError(null);
        setSelectedId((prev) => (list.some((agent) => agent.id === prev) ? prev : (list[0]?.id ?? null)));
      })
      .catch((err) => {
        if (!active) return;
        console.error('Failed to load agents:', err);
        setLoadError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [query, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const select = useCallback((id: string) => setSelectedId(id), []);

  const write = useCallback(async (body: Record<string, unknown>): Promise<WriteOutcome> => {
    try {
      const res = await fetch('/api/settings/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data: unknown = await res.json().catch(() => null);
      const error = readError(data) ?? (res.ok ? undefined : `The write answered ${res.status}`);
      if (error) return { ok: false, error };
      const list = readAgents(data);
      if (list) {
        setAgents(list);
        const written = body.fileName;
        const match = typeof written === 'string'
          ? list.find((agent) => agent.fileName === written)
          : undefined;
        if (match) setSelectedId(match.id);
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }, []);

  const save = useCallback((agent: AgentItem, previousFileName?: string | null) => {
    const fileName = agent.name.trim();
    return write({
      type: 'write',
      fileName,
      name: agent.name,
      description: agent.description,
      ...(agent.model ? { model: agent.model } : {}),
      ...(agent.thinkingLevel ? { thinkingLevel: agent.thinkingLevel } : {}),
      // `tools: undefined` leaves the file's own allowlist untouched.
      ...(agent.tools ? { tools: agent.tools } : {}),
      ...(agent.spawns ? { spawns: agent.spawns } : {}),
      systemPrompt: agent.systemPrompt,
      ...(previousFileName && previousFileName !== fileName ? { previousFileName } : {}),
    });
  }, [write]);

  const remove = useCallback(async (agent: AgentItem): Promise<WriteOutcome> => {
    if (!agent.fileName) return { ok: false, error: 'This agent has no definition file to delete.' };
    const outcome = await write({ type: 'delete', fileName: agent.fileName });
    if (outcome.ok) {
      setSelectedId((current) => (current === agent.id ? null : current));
      setAgents((prev) => prev.filter((item) => item.id !== agent.id));
    }
    return outcome;
  }, [write]);

  return {
    agents,
    selectedId,
    selected: agents.find((agent) => agent.id === selectedId),
    isLoading,
    loadError,
    reload,
    select,
    save,
    remove,
  };
}
