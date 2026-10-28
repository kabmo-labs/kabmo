/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Client view of the scheduled tasks (SQLite `scheduled_tasks`, owned by the
 * server). Every mutation returns the canonical list, which replaces local
 * state wholesale — the same contract the follow-up queue panel uses, and for
 * the same reason: the runtime advances `next_run_at` on its own clock, so a
 * locally-merged list would drift from the one the server is actually running.
 *
 * Polled while the modal is open, because the interesting change is the one the
 * SERVER makes — a fire that just happened. A closed modal costs nothing.
 */

import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { useRealtimeTopic } from '@/client/hooks/ui/realtime';
import { TOPIC_SCHEDULE } from '@/shared/lib/realtime/protocol';
import type { ScheduleKind, ScheduledTask, ScheduledTaskModel, ScheduledTaskRun } from '@/shared/types/schedule';

export interface ScheduleDraft {
  name: string;
  prompt: string;
  kind: ScheduleKind;
  spec: string;
  folderId: number | null;
  sessionId: string | null;
  model: ScheduledTaskModel | null;
}

async function readList(res: Response): Promise<ScheduledTask[] | null> {
  const data = (await res.json().catch(() => null)) as { tasks?: ScheduledTask[]; error?: string } | null;
  if (!res.ok || !data || data.error) return null;
  return data.tasks ?? [];
}

export interface ScheduleController {
  tasks: ScheduledTask[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  create: (draft: ScheduleDraft) => Promise<string | null>;
  patch: (id: string, patch: Partial<ScheduleDraft> & { enabled?: boolean }) => Promise<string | null>;
  remove: (id: string) => Promise<string | null>;
  runNow: (id: string) => Promise<string | null>;
  loadRuns: (id: string) => Promise<ScheduledTaskRun[]>;
}

export function useScheduledTasks(active: boolean): ScheduleController {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await readList(await fetch('/api/schedule'));
      if (list) {
        setTasks(list);
        setError(null);
      } else {
        setError('Could not load scheduled tasks.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // The schedule topic is the read path: a snapshot on subscribe, then a push
  // whenever a task is written — by this tab, another tab, or the runtime's own
  // fire. `refresh` stays for a caller that needs an immediate re-read.
  const topic = useRealtimeTopic<ScheduledTask[]>(TOPIC_SCHEDULE, { enabled: active });
  useEffect(() => {
    if (!topic.data) return;
    setTasks(topic.data);
    setLoading(false);
    setError(null);
  }, [topic.data]);

  /** One write path for every mutation: POST/PATCH/DELETE all answer with the
   *  canonical list, so a success never needs a second round trip. */
  const mutate = useCallback(async (input: string, init: RequestInit): Promise<string | null> => {
    try {
      const res = await fetch(input, init);
      const data = (await res.json().catch(() => null)) as { tasks?: ScheduledTask[]; error?: string; sessionId?: string } | null;
      if (!res.ok || !data || data.error) {
        const message = data?.error ?? `HTTP ${res.status}`;
        setError(message);
        return message;
      }
      // Adopted for the immediate response; the server's own republish is what
      // reaches every other tab and the badge.
      if (data.tasks) setTasks(data.tasks);
      setError(null);
      return null;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      return message;
    }
  }, []);

  const create = useCallback(async (draft: ScheduleDraft) => {
    const failure = await mutate('/api/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    });
    return failure;
  }, [mutate]);

  const patch = useCallback(async (id: string, body: Partial<ScheduleDraft> & { enabled?: boolean }) => {
    return mutate(`/api/schedule?id=${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }, [mutate]);

  const remove = useCallback(async (id: string) => {
    return mutate(`/api/schedule?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  }, [mutate]);

  const runNow = useCallback(async (id: string) => {
    const failure = await mutate(`/api/schedule?id=${encodeURIComponent(id)}&run=now`, { method: 'POST' });
    return failure;
  }, [mutate]);

  const loadRuns = useCallback(async (id: string): Promise<ScheduledTaskRun[]> => {
    try {
      const res = await fetch(`/api/schedule/${encodeURIComponent(id)}/runs`);
      const data = (await res.json().catch(() => null)) as { runs?: ScheduledTaskRun[] } | null;
      return res.ok ? data?.runs ?? [] : [];
    } catch {
      return [];
    }
  }, []);

  return { tasks, loading, error, refresh, create, patch, remove, runNow, loadRuns };
}

/**
 * How many tasks are armed, for the sidebar button's badge.
 *
 * A separate read from `useScheduledTasks` because the sidebar renders it on
 * every session list refresh — where the modal is closed and the full task list
 * (with its run history columns) would be payload nobody looks at. The count is
 * what makes the Calendar button say whether anything is scheduled at all; a
 * button that opens a list you cannot see the state of is what the mock was.
 */
export function useScheduledTaskCount(): number {
  // Derived from the SAME topic the modal reads, so the badge cannot disagree
  // with the list, and the modal's own writes reach it without an event.
  const topic = useRealtimeTopic<ScheduledTask[]>(TOPIC_SCHEDULE);
  return useMemo(() => (topic.data ?? []).filter((task) => task.enabled).length, [topic.data]);
}
