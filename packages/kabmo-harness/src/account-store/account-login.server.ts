/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Sign-in as a server-side process, with Kabmo drawing the result.
 *
 * The CLI still needs a TTY (it prints a link, reads a code, or both), so this
 * spawns it on a PTY. What it does NOT need is a terminal UI: output is decoded,
 * ANSI is stripped, and the auth URL and the last lines are returned to the
 * settings panel. The user pastes a code back through the same PTY.
 *
 * A job is one account and one process. Starting again replaces a finished job;
 * a running job is returned instead of spawning twice. Cancel kills the tree;
 * a normal exit keeps the final state for the UI to read.
 */

import { accountAdapter, type AccountHarness } from '@kabmo-labs/kabmo-harness/accounts';
import { harnessAccountTarget } from '@kabmo-labs/kabmo-harness/account-store';
import { killProcessTree } from '@kabmo-labs/kabmo-process/kill';

export type AccountLoginPhase = 'running' | 'done' | 'error' | 'cancelled';

export interface AccountLoginView {
  phase: AccountLoginPhase;
  url: string | null;
  /** The most recent sanitized output, one string per line. */
  lines: string[];
  error: string | null;
}

interface LoginJob {
  accountId: string;
  harness: AccountHarness;
  homePath: string;
  phase: AccountLoginPhase;
  url: string | null;
  raw: string;
  error: string | null;
  child: Bun.Subprocess | null;
  term: Bun.Terminal | null;
  decoder: TextDecoder;
  timeout: NodeJS.Timeout | null;
}

declare global {
  // eslint-disable-next-line no-var
  var __kabmoAccountLogins: Map<string, LoginJob> | undefined;
  // eslint-disable-next-line no-var
  var __kabmoAccountLoginCleanup: boolean | undefined;
}

const jobs = (): Map<string, LoginJob> => (globalThis.__kabmoAccountLogins ??= new Map());

/** One listener for every job: a detached PTY must not outlive the server. */
function installExitCleanup(): void {
  if (globalThis.__kabmoAccountLoginCleanup) return;
  globalThis.__kabmoAccountLoginCleanup = true;
  process.once('exit', () => {
    for (const job of jobs().values()) {
      try {
        job.child?.kill();
      } catch {
        // Already gone.
      }
    }
  });
}
const MAX_OUTPUT = 64_000;
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const FORGET_AFTER_MS = 10 * 60 * 1000;

/** Strip the terminal control bytes a PTY emits before a line reaches the UI. */
export function cleanLoginText(text: string): string {
  return text
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[()][A-Z0-9]/g, '')
    .replace(/\r/g, '');
}

const URL_PATTERN = /https?:\/\/[^\s"'<>]+/g;

/** The link a user has to open, preferring an OAuth page over a local server. */
export function extractLoginUrl(text: string): string | null {
  const urls = [...cleanLoginText(text).matchAll(URL_PATTERN)]
    .map((match) => match[0].replace(/[),.;]+$/, ''))
    .filter((url) => url.length > 8);
  if (urls.length === 0) return null;
  const auth = urls.filter((url) => /authorize|oauth|device|login|signin|auth/i.test(url));
  const notLocal = auth.filter((url) => !/^https?:\/\/(?:localhost|127\.0\.0\.1)[:/]/i.test(url));
  return notLocal.at(-1) ?? auth.at(-1) ?? urls.at(-1) ?? null;
}

function linesOf(raw: string): string[] {
  return cleanLoginText(raw)
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .slice(-14);
}

function viewOf(job: LoginJob): AccountLoginView {
  return {
    phase: job.phase,
    url: job.url,
    lines: linesOf(job.raw),
    error: job.error,
  };
}

function append(job: LoginJob, bytes: Uint8Array): void {
  job.raw = (job.raw + job.decoder.decode(bytes, { stream: true })).slice(-MAX_OUTPUT);
  job.url = job.url ?? extractLoginUrl(job.raw);
}

function finish(job: LoginJob, code: number | null): void {
  if (job.phase === 'cancelled') return;
  job.phase = code === 0 ? 'done' : 'error';
  if (code !== 0) job.error = `The sign-in command exited with code ${code ?? 'unknown'}.`;
  job.term?.close();
  job.term = null;
  if (job.timeout) clearTimeout(job.timeout);
  job.timeout = null;
  const timer = setTimeout(() => {
    if (jobs().get(job.accountId) === job) jobs().delete(job.accountId);
  }, FORGET_AFTER_MS);
  timer.unref?.();
}

export interface StartAccountLoginOptions {
  /** Test seam: replace the adapter's binary and arguments. */
  command?: readonly string[];
}

export async function startAccountLogin(
  accountId: string,
  options: StartAccountLoginOptions = {},
): Promise<AccountLoginView> {
  const existing = jobs().get(accountId);
  if (existing && existing.phase === 'running') return viewOf(existing);

  const target = await harnessAccountTarget(accountId);
  const adapter = accountAdapter(target.harness);
  if (!adapter) throw new Error(`${target.harness} does not support saved accounts.`);
  const command = options.command ?? [adapter.loginBinary, ...adapter.loginArgs];
  const env: Record<string, string | undefined> = { ...Bun.env };
  for (const name of adapter.stripEnv) delete env[name];
  Object.assign(env, adapter.env(target.homePath));

  const job: LoginJob = {
    accountId,
    harness: target.harness,
    homePath: target.homePath,
    phase: 'running',
    url: null,
    raw: '',
    error: null,
    child: null,
    term: null,
    decoder: new TextDecoder(),
    timeout: null,
  };
  jobs().set(accountId, job);

  const term = new Bun.Terminal({
    cols: 500,
    rows: 50,
    name: 'xterm-256color',
    data(_term, bytes) {
      append(job, bytes);
    },
  });
  job.term = term;

  try {
    const child = Bun.spawn({
      cmd: [...command],
      cwd: target.homePath,
      env,
      terminal: term,
      detached: process.platform !== 'win32',
    });
    job.child = child;
    job.timeout = setTimeout(() => {
      job.phase = 'error';
      job.error = 'Sign-in timed out after five minutes.';
      killProcessTree(child.pid, true, 'SIGTERM');
    }, LOGIN_TIMEOUT_MS);
    job.timeout.unref?.();
    void child.exited.then((code) => finish(job, code));
    installExitCleanup();
  } catch (error) {
    job.phase = 'error';
    job.error = error instanceof Error ? error.message : 'Could not start the sign-in command.';
    term.close();
    job.term = null;
  }

  return viewOf(job);
}

export function accountLoginStatus(accountId: string): AccountLoginView | null {
  const job = jobs().get(accountId);
  return job ? viewOf(job) : null;
}

export function submitAccountLoginInput(accountId: string, text: string): AccountLoginView {
  const job = jobs().get(accountId);
  if (!job || job.phase !== 'running' || !job.term) {
    throw new Error('That sign-in is no longer running.');
  }
  job.term.write(`${text}\r`);
  return viewOf(job);
}

export function cancelAccountLogin(accountId: string): void {
  const job = jobs().get(accountId);
  if (!job) return;
  if (job.phase !== 'running') {
    jobs().delete(accountId);
    return;
  }
  job.phase = 'cancelled';
  job.error = null;
  if (job.timeout) clearTimeout(job.timeout);
  job.timeout = null;
  if (job.child?.pid) killProcessTree(job.child.pid, true, 'SIGTERM');
  job.term?.close();
  job.term = null;
}
