import type { KabmoPluginApi } from '@kabmo-labs/kabmo-sdk';

import {
  RPC,
  type ActInput,
  type ActResult,
  type ListInput,
  type LogInput,
  type LogTail,
  type RunDetail,
  type RunInput,
  type RunPage,
  type RunVerb,
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
 * Two decisions live here rather than in the adapter:
 *
 * - **A read is also a cache fill.** Every successful list fills the plugin's
 *   HTTP cache, so a second tab that asks the same question answers `304` — no
 *   extra request, no second source of truth.
 * - **A write invalidates by prefix.** Cancel and re-run change the run, its jobs
 *   and the list that carried it — three cached URLs — so the whole
 *   `/actions/runs` prefix for the repository is dropped rather than enumerated.
 */

interface Settings {
  token: string;
  apiBase: string;
  perPage: number;
  logTailKb: number;
}

export default function plugin(api: KabmoPluginApi) {
  const cache: JsonCache = kvCache(api.storage.kv);

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
      logTailKb: Math.min(1024, Math.max(1, number('logTailKb', 64))),
    };
  }

  /**
   * Everything a read needs. A refusal is THROWN, because the host reports a
   * thrown handler as `{ ok: false, error }` — the one shape the kit's `useRpc`
   * surfaces as a failure. Returning a `{ ok: false }` value instead would reach
   * the panel as a SUCCESS whose payload happens to describe an error, which is
   * the exactly-wrong-but-plausible outcome this comment prevents.
   */
  async function contextFor(input: { root: string; repo: string }): Promise<GithubContext> {
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
      apiBase: remote.apiBase,
      slug: remote.slug,
      host: remote.host,
      token: credential.token,
      perPage: settings.perPage,
      cache,
    };
  }

  /** One list read. */
  async function readPage(input: ListInput): Promise<RunPage> {
    const resolved = await contextFor(input);
    const result = await listRuns(resolved, input.filter);
    if (!result.ok) throw new Error(result.message);
    return {
      slug: resolved.slug,
      host: resolved.host,
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
      const run = await getRun(resolved, input.id);
      if (!run.ok) throw new Error(run.message);
      const jobs = await listJobs(resolved, input.id);
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
      const log = await jobLog(resolved, input.jobId, cap);
      if (!log.ok) throw new Error(log.message);
      return log.log;
    },
  });

  api.rpc.register<ActInput, unknown>(RPC.act, {
    handler: async (input): Promise<ActResult> => {
      const verbs: readonly RunVerb[] = ['cancel', 'rerun', 'rerun-failed'];
      if (!verbs.includes(input.verb)) throw new Error(`Unknown verb "${String(input.verb)}".`);
      const resolved = await contextFor(input);
      const result = await act(resolved, input.id, input.verb);
      if (!result.ok) throw new Error(result.message);
      // The run, its jobs and the list all describe the state the verb changed.
      await cache.invalidate(`/repos/${resolved.slug}/actions/`);
      return { message: result.message };
    },
  });

  api.log.info('github-actions server half loaded');
}
