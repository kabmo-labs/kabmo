/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Antigravity's quota, read from THIS MACHINE instead of from omp.
 *
 * omp has an adapter for `google-antigravity`, but Kabmo can only see it when
 * omp's own credential store holds the sign-in; the Antigravity CLI/IDE keeps
 * its OAuth token in the OS keyring, so a machine that runs Antigravity and not
 * omp's provider showed an empty quota card. This reader talks to the same
 * Cloud Code Assist endpoint with the local sign-in, so the card works with
 * `omp` absent, logged out, or merely older than the endpoint.
 *
 * The shapes and the endpoint are stated (with their measurements) in
 * `antigravity-quota.ts`; this file is the machine side: the keyring read, the
 * expiry check, the project lookup and the one-minute cache.
 *
 * Measured on this machine, 2026-11-24: the daily host answers BOTH model
 * groups, the non-daily host only the `3p-*` groups, and the sandbox host is
 * last — omp's own host order.
 *
 * An expired access token is NOT refreshed here. Renewal needs Antigravity's
 * installed-app OAuth client, which exists only inside the shipped `agy`
 * binary, and GitHub push protection refuses a repository containing it — so
 * the token is used while its stored lifetime allows and the card names the fix
 * afterwards: the CLI's next run rewrites the keyring it owns.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { antigravityHome } from '@kabmo-labs/kabmo-harness-local-transcript/antigravity-home';
import {
  antigravityWindows,
  decodeKeyringSecret,
  parseAntigravityCredential,
  parseAntigravityProject,
  type AntigravityCredential,
  type LocalAntigravityReport,
} from '@/server/lib/usage/antigravity-quota';
import { isRecord } from '@kabmo-labs/kabmo-guards';
import type { UsageLimitWindow } from '@/shared/types';

/** Hosts tried in order. Measured: the daily host answers BOTH model groups. */
const HOSTS = [
  'https://daily-cloudcode-pa.googleapis.com',
  'https://cloudcode-pa.googleapis.com',
  'https://daily-cloudcode-pa.sandbox.googleapis.com',
] as const;

const QUOTA_PATH = '/v1internal:retrieveUserQuotaSummary';
const LOAD_CODE_ASSIST_PATH = '/v1internal:loadCodeAssist';

const KEYCHAIN_SERVICE = 'gemini';
const KEYCHAIN_ACCOUNT = 'antigravity';
const TOKEN_FILE = 'jetski-standalone-oauth-token';
const PROJECT_FILE = join('antigravity-cli', 'cache', 'default_project_id.txt');

/** A quota read calls Google; the topic re-publishes on every panel open. */
const CACHE_TTL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;

/** A user agent the endpoint accepts; the version is informational. */
function userAgent(): string {
  const os = process.platform === 'win32' ? 'windows' : process.platform;
  const arch = process.arch === 'x64' ? 'amd64' : process.arch;
  return `antigravity/hub/1.0.0 (aidev_client; os_type=${os}; arch=${arch}; cl=1005016104)`;
}

function requestHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': userAgent(),
    'Accept-Encoding': 'gzip',
  };
}

/** The keyring item, on the platform whose keyring `agy` writes. */
async function readKeyringValue(): Promise<string | null> {
  if (process.platform !== 'darwin') return null;
  try {
    const result = Bun.spawnSync(
      ['security', 'find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w'],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    if (result.exitCode !== 0) return null;
    const value = result.stdout.toString().trim();
    return value.length > 0 ? value : null;
  } catch {
    // no-excuse-ok: catch — a missing keyring tool is "not signed in", not a failure to report
    return null;
  }
}

async function readTokenFile(): Promise<string | null> {
  try {
    return await readFile(join(antigravityHome(), TOKEN_FILE), 'utf8');
  } catch {
    // no-excuse-ok: catch — the file is optional; the keyring is the primary store
    return null;
  }
}

/** The local Antigravity sign-in, or null when this machine has none. */
export async function readLocalAntigravityCredential(): Promise<AntigravityCredential | null> {
  const keyring = await readKeyringValue();
  const fromKeyring = keyring ? parseAntigravityCredential(decodeKeyringSecret(keyring)) : null;
  if (fromKeyring) return fromKeyring;
  const file = await readTokenFile();
  return file ? parseAntigravityCredential(decodeKeyringSecret(file)) : null;
}

/**
 * The stored access token while its stated lifetime has not run out, else null.
 *
 * Null is a fact the card reports ("open Antigravity once"), never a stale
 * number and never a silent refresh: the installed-app OAuth client that a
 * refresh requires lives only inside `agy`, which renews the keyring itself.
 */
export function usableAccessToken(credential: AntigravityCredential): string | null {
  const expiresAt = credential.expiresAt;
  if (expiresAt === undefined || expiresAt > Date.now()) return credential.accessToken;
  return null;
}

/** The project the quota endpoint scopes by, from the CLI's own cache file. */
async function readProjectId(): Promise<string | null> {
  try {
    return parseAntigravityProject(await readFile(join(antigravityHome(), PROJECT_FILE), 'utf8'));
  } catch {
    // no-excuse-ok: catch — a missing cache file falls through to loadCodeAssist
    return null;
  }
}

/** Discover the Cloud Code project the way omp's oauth hook does. */
async function discoverProjectId(token: string): Promise<string | null> {
  const body = (project?: string) => JSON.stringify({
    metadata: { ideType: 'ANTIGRAVITY' },
    ...(project ? { cloudaicompanionProject: project } : {}),
  });
  const ask = async (payload: string): Promise<Record<string, unknown> | null> => {
    const response = await fetch(`${HOSTS[0]}${LOAD_CODE_ASSIST_PATH}`, {
      method: 'POST',
      headers: requestHeaders(token),
      body: payload,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const json: unknown = await response.json();
    return isRecord(json) ? json : null;
  };
  const projectOf = (answer: Record<string, unknown> | null): string | null =>
    answer && typeof answer.cloudaicompanionProject === 'string'
      ? parseAntigravityProject(answer.cloudaicompanionProject)
      : null;

  try {
    let answer = await ask(body());
    const project = projectOf(answer);
    // A free-tier answer without `paidTier` names the project only on the
    // second call, which is scoped BY that project (measured behaviour).
    if (answer && project && answer.paidTier === undefined) {
      answer = (await ask(body(project))) ?? answer;
    }
    return projectOf(answer);
  } catch {
    // no-excuse-ok: catch — discovery is a fallback; the caller reports "no project"
    return null;
  }
}

/** One quota read across the hosts, returning the first body with buckets. */
async function fetchQuotaSummary(token: string, project: string): Promise<LocalAntigravityReport> {
  let lastStatus: number | undefined;
  let answered = false;
  for (const host of HOSTS) {
    let response: Response;
    try {
      response = await fetch(`${host}${QUOTA_PATH}`, {
        method: 'POST',
        headers: requestHeaders(token),
        body: JSON.stringify({ project }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      // A dead host is fallback-worthy; a refused one is not (below).
      continue;
    }
    if (response.ok) {
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        return { windows: [], error: 'Antigravity returned an unreadable quota response.' };
      }
      const windows: UsageLimitWindow[] = antigravityWindows(payload);
      if (windows.length > 0) return { windows };
      // A 200 with no buckets is a plan quirk, not a transport error: keep
      // trying the next host before declaring the account empty.
      answered = true;
      continue;
    }
    lastStatus = response.status;
    if (response.status === 401 || response.status === 403) break;
  }

  if (lastStatus === 401 || lastStatus === 403) {
    return {
      windows: [],
      error: 'Antigravity refused the local sign-in. Open Antigravity once so it can renew its session.',
    };
  }
  if (answered) {
    return { windows: [], error: 'Antigravity answered but reported no quota windows for this account.' };
  }
  if (lastStatus !== undefined) {
    return { windows: [], error: `Antigravity quota request failed (HTTP ${lastStatus}).` };
  }
  return { windows: [], error: 'Antigravity quota request failed: no endpoint answered.' };
}

let cache: { until: number; report: LocalAntigravityReport } | null = null;

/**
 * The machine's Antigravity quota, or null when this machine has no Antigravity
 * sign-in (so no row is invented for a product the user does not run).
 *
 * `force` is the user's own Refresh: it bypasses the one-minute cache for the
 * same reason the omp snapshot's does — the button must not answer with a
 * minute-old reading.
 */
export async function buildLocalAntigravityReport(
  options: { force?: boolean } = {},
): Promise<LocalAntigravityReport | null> {
  const now = Date.now();
  if (!options.force && cache && cache.until > now) return cache.report;

  const credential = await readLocalAntigravityCredential();
  if (!credential) return null;

  const token = usableAccessToken(credential);
  if (!token) {
    const report: LocalAntigravityReport = {
      windows: [],
      error: 'The Antigravity sign-in has expired. Open Antigravity once so it can renew its session.',
    };
    cache = { until: now + CACHE_TTL_MS, report };
    return report;
  }

  const project = (await readProjectId()) ?? (await discoverProjectId(token));
  if (!project) {
    const report: LocalAntigravityReport = {
      windows: [],
      error: 'Antigravity has no Cloud Code project on this machine yet. Open Antigravity once so it can create one.',
    };
    cache = { until: now + CACHE_TTL_MS, report };
    return report;
  }

  const report = await fetchQuotaSummary(token, project);
  cache = { until: now + CACHE_TTL_MS, report };
  return report;
}
