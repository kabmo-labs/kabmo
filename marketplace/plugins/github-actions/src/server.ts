import type { KabmoPluginApi, PluginJson } from '@kabmo-labs/kabmo-sdk';

import {
  RPC,
  repoKey,
  type ActInput,
  type ActResult,
  type ListInput,
  type LogInput,
  type LogTail,
  type RunDetail,
  type RunFilter,
  type RunInput,
  type RunPage,
  type RunRow,
  type RunVerb,
  type Snapshot,
  type Snapshots,
} from './protocol';
import { act, getRun, jobLog, listJobs, listRuns, pageSize, type GithubContext } from './server/github';
import { kvCache, type JsonCache } from './server/http';
import { progressOf } from './server/progress';
import { isGithubHost, parseRemote } from './server/remote';
import { readOrigin, resolveScope } from './server/scope';
import { resolveToken } from './server/token';

/**
 * The server half.
 *
 * Three decisions live here rather than in the adapter:
 *
 * - **A read is also a publish.** Every successful list updates the plugin's one
 *   realtime topic, so the header readout and a second tab see the same snapshot
 *   the panel just read — no extra request, no second source of truth.
 * - **The poll loop is ARMED BY WATCHERS.** A tick with nobody watching makes no
 *   request at all; the panel and the readout each `watch` on mount and
 *   `unwatch` on unmount, which is the same shape `stats` uses for its sampler.
 *   What makes this affordable is measured: a conditional read that answers
 *   `304` costs no API quota.
 * - **A write invalidates by prefix.** Cancel and re-run change the run, its jobs
 *   and the list that carried it — three cached URLs — so the whole
 *   `/actions/runs` prefix for the repository is dropped rather than enumerated.
 */

interface Settings {
  token: string;
  apiBase: string;
  perPage: number;
  /** The wait between poll passes, after the setting's seconds are converted. */
  pollMs: number;
  logTailKb: number;
}

interface Watched {
  root: string;
  repo: string;
  filter: RunFilter;
  count: number;
}

/** The poll grammar's floor is 1 minute; 15 s is the tightest a token can afford. */
const MIN_POLL_MS = 15_000;
const MAX_POLL_MS = 300_000;
/** Runs kept in a snapshot: enough for the readout, not a second list payload. */
const SNAPSHOT_RUNS = 30;

export default function plugin(api: KabmoPluginApi) {
  const cache: JsonCache = kvCache(api.storage.kv);
  const entries: Record<string, Snapshot> = {};
  const watched = new Map<string, Watched>();
  const abort = new AbortController();

  async function readSettings(): Promise<Settings> {
    const values = await api.settings.read();
    const number = (key: string, fallback: number): number => {
      const value = values[key];
      return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    };
    return {
      token: typeof values.token === 'string' ? values.token : '',
      apiBase: typeof values.apiBase === 'string' ? values.apiBase : '',
      perPage: pageSize(number('perPage', 30)),
      pollMs: Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, number('pollSeconds', 60) * 1000)),
      logTailKb: Math.min(1024, Math.max(1, number('logTailKb', 64))),
    };
  }

  function publish(): void {
    const payload: Snapshots = { entries };
    api.realtime.publish(payload as unknown as PluginJson);
  }

  function remember(key: string, runs: readonly RunRow[]): void {
    const recent = runs.slice(0, SNAPSHOT_RUNS);
    entries[key] = {
      at: new Date().toISOString(),
      runs: recent,
      failing: recent.filter((run) => run.state === 'failure').length,
      running: recent.filter((run) => run.state === 'pending').length,
    };
    publish();
  }

  /**
   * Everything a read needs. A refusal is THROWN, because the host reports a
   * thrown handler as `{ ok: false, error }` — the one shape the kit's `useRpc`
   * surfaces as a failure. Returning a `{ ok: false }` value instead would reach
   * the panel as a SUCCESS whose payload happens to describe an error, which is
   * the exactly-wrong-but-plausible outcome this comment prevents.
   */
  async function contextFor(input: { root: string; repo: string }): Promise<{ context: GithubContext; key: string }> {
    const dir = resolveScope(input);
    if (!dir) throw new Error('That repository path is outside the workspace root.');
    const origin = readOrigin(dir);
    if (!origin) {
      throw new Error('This checkout has no `origin` remote. Add one with `git remote add origin <url>`.');
    }
    const settings = await readSettings();
    const remote = parseRemote(origin, settings.apiBase);
    if (!remote) throw new Error(`This plugin cannot read the remote \`${origin}\`.`);
    if (!isGithubHost(remote.host)) {
      throw new Error(`Actions is GitHub's: this checkout's remote is ${remote.host}.`);
    }
    const credential = resolveToken({ setting: settings.token, env: Bun.env, host: remote.host });
    return {
      key: repoKey(input.root, input.repo),
      context: {
        apiBase: remote.apiBase,
        slug: remote.slug,
        host: remote.host,
        token: credential.token,
        perPage: settings.perPage,
        cache,
      },
    };
  }

  /** One list read, plus the snapshot it publishes. */
  async function readPage(input: ListInput): Promise<RunPage> {
    const resolved = await contextFor(input);
    const result = await listRuns(resolved.context, input.filter);
    if (!result.ok) throw new Error(result.message);
    remember(resolved.key, result.runs);
    return {
      slug: resolved.context.slug,
      host: resolved.context.host,
      authenticated: result.authenticated,
      branch: input.filter.branch,
      status: input.filter.status,
      runs: result.runs,
      total: result.total,
      truncated: result.truncated,
      notes: result.notes,
    };
  }

  api.rpc.register<ListInput, unknown>(RPC.list, {
    handler: (input) => {
      if (!input || typeof input.root !== 'string') throw new Error('A workspace root is required.');
      return readPage({
        root: input.root,
        repo: typeof input.repo === 'string' ? input.repo : '.',
        filter: {
          branch: typeof input.filter?.branch === 'string' ? input.filter.branch : '',
          status: typeof input.filter?.status === 'string' ? input.filter.status : '',
        },
      });
    },
  });

  api.rpc.register<RunInput, unknown>(RPC.run, {
    handler: async (input): Promise<RunDetail> => {
      const resolved = await contextFor(input);
      const run = await getRun(resolved.context, input.id);
      if (!run.ok) throw new Error(run.message);
      const jobs = await listJobs(resolved.context, input.id);
      if (!jobs.ok) throw new Error(jobs.message);
      return {
        run: run.run,
        jobs: jobs.jobs,
        progress: progressOf(jobs.jobs),
        notes: jobs.notes,
      };
    },
  });

  api.rpc.register<LogInput, unknown>(RPC.log, {
    handler: async (input): Promise<LogTail> => {
      const resolved = await contextFor(input);
      const settings = await readSettings();
      const cap = typeof input.tail === 'number' && input.tail > 0 ? input.tail : settings.logTailKb * 1024;
      const log = await jobLog(resolved.context, input.jobId, cap);
      if (!log.ok) throw new Error(log.message);
      return log.log;
    },
  });

  api.rpc.register<ActInput, unknown>(RPC.act, {
    handler: async (input): Promise<ActResult> => {
      const verbs: readonly RunVerb[] = ['cancel', 'rerun', 'rerun-failed'];
      if (!verbs.includes(input.verb)) throw new Error(`Unknown verb "${String(input.verb)}".`);
      const resolved = await contextFor(input);
      const result = await act(resolved.context, input.id, input.verb);
      if (!result.ok) throw new Error(result.message);
      // The run, its jobs and the list all describe the state the verb changed.
      await cache.invalidate(`/repos/${resolved.context.slug}/actions/`);
      return { message: result.message };
    },
  });

  api.rpc.register<ListInput, unknown>(RPC.watch, {
    handler: async (input) => {
      const key = repoKey(input.root, input.repo);
      const existing = watched.get(key);
      if (existing) {
        existing.count += 1;
        existing.filter = input.filter;
      } else {
        watched.set(key, { root: input.root, repo: input.repo, filter: input.filter, count: 1 });
      }
      // Publish now rather than at the next tick: the readout should not wait a
      // minute to learn what the panel is already looking at. A refusal here is
      // the panel's own read to report, so the fire-and-forget copy only logs it.
      void readPage(input).catch((cause: unknown) => {
        api.log.warn('initial read failed', cause instanceof Error ? cause.message : String(cause));
      });
      return { watching: watched.get(key)?.count ?? 0 };
    },
  });

  api.rpc.register<ListInput, unknown>(RPC.unwatch, {
    handler: (input) => {
      const key = repoKey(input.root, input.repo);
      const existing = watched.get(key);
      if (existing) {
        existing.count -= 1;
        if (existing.count <= 0) watched.delete(key);
      }
      return { watching: Math.max(0, watched.get(key)?.count ?? 0) };
    },
  });

  /** One pass over the watched repositories, serial. */
  async function pass(): Promise<void> {
    for (const [key, watch] of watched) {
      if (watch.count <= 0) continue;
      try {
        await readPage({ root: watch.root, repo: watch.repo, filter: watch.filter });
      } catch (cause) {
        // Reported under the plugin's own name, once per tick; the loop keeps
        // going because one dead repository must not stop the others.
        const message = cause instanceof Error ? cause.message : String(cause);
        api.log.warn(`run list failed for ${key.split('\u0000').join('/')}`, message);
      }
    }
  }

  api.background.service('poller', {
    start() {
      void (async () => {
        while (!abort.signal.aborted) {
          const wait = (await readSettings()).pollMs;
          const { promise, resolve } = Promise.withResolvers<void>();
          const timer = setTimeout(resolve, wait);
          abort.signal.addEventListener('abort', () => {
            clearTimeout(timer);
            resolve();
          }, { once: true });
          await promise;
          if (abort.signal.aborted) return;
          try {
            await pass();
          } catch (cause) {
            api.log.warn('poll pass threw', cause instanceof Error ? cause.message : String(cause));
          }
        }
      })();
    },
    stop() {
      abort.abort();
    },
  });

  api.onDispose(() => {
    abort.abort();
    watched.clear();
  });

  api.log.info('github-actions server half loaded');
}
