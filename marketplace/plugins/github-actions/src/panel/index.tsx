/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Runs panel.
 *
 * Three things it deliberately does NOT own:
 *
 * - **The repository.** `useRepoScope()` is the pick the Files, Search, Source
 *   Control, Terminal and Forge panels share, so switching repos anywhere moves
 *   this panel too. A private pick would let the panel describe a repository the
 *   rest of the window is not looking at.
 * - **The list.** It comes from the plugin's own server half, which is the only
 *   part that holds a credential and can reach GitHub.
 * - **A poll.** Reads happen when the panel opens, when the filter moves, on
 *   Refresh, and when the server's watcher publishes a new snapshot. A panel
 *   timer would fire against a view nobody is looking at.
 *
 * The watch is armed on mount and released on unmount. A plugin panel is
 * unmounted when another view is on screen, so "unmounted" is exactly "nobody is
 * looking" — the server's tick then makes no request at all.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { usePanelHost, useRepoScope, useRpc, useSessionState } from '@kabmo-labs/kabmo-ui';

import {
  RPC,
  type ActInput,
  type ActResult,
  type ListInput,
  type RunDetail,
  type RunFilter,
  type RunPage,
  type RunVerb,
} from '../protocol';
import { RunView } from './RunView';
import { RunRowView } from './Row';
import { age, stateClass, stateMark } from './format';

const NO_FILTER: RunFilter = { branch: '', status: '' };

const STATUSES = [
  { value: '', label: 'All states' },
  { value: 'in_progress', label: 'Running' },
  { value: 'failure', label: 'Failing' },
  { value: 'success', label: 'Passing' },
  { value: 'queued', label: 'Queued' },
] as const;

export function ActionsPanel() {
  const host = usePanelHost();
  const scope = useRepoScope();
  const root = scope.root ?? '';
  const repo = scope.repo || '.';

  const [filter, setFilter] = useSessionState<RunFilter>('actions.filter', NO_FILTER);
  const [selected, setSelected] = useSessionState<number | null>('actions.runId', null);
  const [page, setPage] = useState<RunPage | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [actBusy, setActBusy] = useState(false);
  const [actMessage, setActMessage] = useState<string | null>(null);
  const [actError, setActError] = useState<string | null>(null);
  const [branchDraft, setBranchDraft] = useState(filter.branch);

  const list = useRpc<ListInput, RunPage>(RPC.list);
  const run = useRpc<{ root: string; repo: string; id: number }, RunDetail>(RPC.run);
  const act = useRpc<ActInput, ActResult>(RPC.act);
  const watch = useRpc<ListInput, unknown>(RPC.watch);
  const unwatch = useRpc<ListInput, unknown>(RPC.unwatch);

  // `useRpc` hands back a fresh object per render, so putting `call` in a
  // dependency list re-runs the read on every render — the unbounded loop the
  // forge panel's `use-forge.ts` documents. Refs hold the newest call while the
  // effects key on the facts that actually changed.
  const listCall = useRef(list.call);
  listCall.current = list.call;
  const runCall = useRef(run.call);
  runCall.current = run.call;
  const actCall = useRef(act.call);
  actCall.current = act.call;
  const watchCall = useRef(watch.call);
  watchCall.current = watch.call;
  const unwatchCall = useRef(unwatch.call);
  unwatchCall.current = unwatch.call;

  const filterKey = `${filter.branch}\u0000${filter.status}`;

  const readList = (): void => {
    if (!root) return;
    setLoading(true);
    void listCall.current({ root, repo, filter }).then((outcome) => {
      setLoading(false);
      if (outcome.ok) {
        setPage(outcome.value as RunPage);
        setError(null);
      } else {
        setError(outcome.error.message);
      }
    });
  };

  useEffect(() => {
    if (!host.active) return;
    readList();
  }, [root, repo, filterKey, host.active, host.refreshKey]);

  useEffect(() => {
    if (!host.active || !root) return;
    const input = { root, repo, filter };
    void watchCall.current(input);
    return () => {
      void unwatchCall.current(input);
    };
  }, [root, repo, filterKey, host.active]);

  const readDetail = (id: number): void => {
    if (!root) return;
    setDetail(null);
    setDetailError(null);
    void runCall.current({ root, repo, id }).then((outcome) => {
      if (outcome.ok) setDetail(outcome.value as RunDetail);
      else setDetailError(outcome.error.message);
    });
  };

  useEffect(() => {
    if (selected === null) {
      setDetail(null);
      return;
    }
    readDetail(selected);
  }, [selected, root, repo, host.refreshKey]);

  const onAct = (verb: RunVerb): void => {
    if (selected === null) return;
    setActBusy(true);
    setActError(null);
    setActMessage(null);
    void actCall.current({ root, repo, id: selected, verb }).then((outcome) => {
      setActBusy(false);
      if (outcome.ok) {
        setActMessage((outcome.value as ActResult).message);
        readList();
        readDetail(selected);
      } else {
        setActError(outcome.error.message);
      }
    });
  };

  if (!root) {
    return <p class="px-3 py-3 text-[11px] text-ink/55">Open a workspace folder to read its Actions runs.</p>;
  }

  if (selected !== null) {
    if (detailError) {
      return (
        <div class="px-3 py-3">
          <p class="text-[11px] text-error-text">{detailError}</p>
          <button
            type="button"
            onClick={() => setSelected(null)}
            class="mt-2 rounded border border-ink/15 px-2 py-0.5 text-[11px] text-ink/70 hover:bg-ink/5"
          >
            ← Runs
          </button>
        </div>
      );
    }
    if (!detail) return <p class="px-3 py-3 text-[11px] text-ink/50">Reading the run…</p>;
    return (
      <RunView
        detail={detail}
        root={root}
        repo={repo}
        authenticated={page?.authenticated ?? true}
        actBusy={actBusy}
        actError={actError}
        actMessage={actMessage}
        onBack={() => setSelected(null)}
        onAct={onAct}
      />
    );
  }

  return (
    <div class="flex min-h-0 h-full flex-col">
      <div class="flex flex-wrap items-center gap-1.5 border-b border-ink/10 px-3 py-1.5">
        <input
          value={branchDraft}
          placeholder="any branch"
          aria-label="Branch"
          onInput={(event) => setBranchDraft((event.currentTarget as HTMLInputElement).value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') setFilter({ ...filter, branch: branchDraft });
          }}
          onBlur={() => {
            if (branchDraft !== filter.branch) setFilter({ ...filter, branch: branchDraft });
          }}
          class="w-24 rounded border border-ink/15 bg-transparent px-1.5 py-0.5 font-mono text-[10.5px] text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none"
        />
        <select
          value={filter.status}
          aria-label="State"
          onChange={(event) => setFilter({ ...filter, status: (event.currentTarget as HTMLSelectElement).value })}
          class="rounded border border-ink/15 bg-transparent px-1 py-0.5 text-[10.5px] text-ink focus:border-ink/30 focus:outline-none"
        >
          {STATUSES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span class="font-mono text-[10px] text-ink/40">
          {page ? `${page.runs.length}${page.total !== null ? `/${page.total}` : ''} · ${repo}` : ''}
        </span>
        <button
          type="button"
          onClick={readList}
          class="ml-auto rounded border border-ink/15 px-1.5 py-0.5 text-[10.5px] text-ink/70 hover:bg-ink/5"
        >
          Refresh
        </button>
      </div>

      {page?.notes.map((note) => (
        <p key={note} class="border-b border-ink/5 bg-canvas/40 px-3 py-1 text-[10.5px] text-ink/55">
          {note}
        </p>
      ))}
      {error ? <p class="px-3 py-2 text-[11px] text-error-text">{error}</p> : null}

      <div class="min-h-0 flex-1 overflow-auto">
        {loading && !page ? (
          <p class="px-3 py-3 text-[11px] text-ink/45">Reading runs…</p>
        ) : page && page.runs.length === 0 && !error ? (
          <p class="px-3 py-3 text-[11px] text-ink/55">
            No runs match this filter. Clear the branch or state to see every run.
          </p>
        ) : (
          page?.runs.map((row) => <RunRowView key={row.id} run={row} onOpen={(runRow) => setSelected(runRow.id)} />)
        )}
      </div>

      <p class="flex items-center gap-1.5 border-t border-ink/10 px-3 py-1 font-mono text-[10px] text-ink/40">
        <span class={page && page.runs[0] ? stateClass(page.runs[0].state) : 'text-ink/40'} aria-hidden="true">
          {page && page.runs[0] ? stateMark(page.runs[0].state) : '–'}
        </span>
        <span class="truncate">
          {page && page.runs[0] ? `latest ${page.runs[0].name} · ${age(page.runs[0].updatedAt)}` : 'no runs read yet'}
        </span>
      </p>
    </div>
  );
}
