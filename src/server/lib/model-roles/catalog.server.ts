/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The model catalog behind the role dropdowns.
 *
 * Read from `omp models --json --kind all` — the CLI's own listing, so the
 * candidates are exactly what omp can resolve (a model removed from
 * `models.yml`, or one whose provider lost its credential, does not appear).
 * `get_available_models` over RPC was the alternative and was rejected: it
 * answers CHAT models only (`modelRegistry.getAvailable()` defaults to kind
 * `chat`), so the five kind roles would have had nothing to offer.
 *
 * One limit is worth naming: the CLI's JSON does not carry `webSearch`, so a
 * CHAT model that omp's `web` role would also accept cannot be identified
 * here. `web` therefore offers search-kind rows; a chat model already assigned
 * to it stays selectable through the dropdown's current-value option.
 *
 * Cached for a minute on `globalThis` — a listing spawn costs ~1.3 s and the
 * settings panel reads it on open and on Refresh.
 */

import { childEnv } from '@/server/lib/fs/child-env';
import { resolveOmpBin } from '@/server/lib/omp/core/cli';
import { isMockMode } from '@/server/mock.server';
import { mockRoleCandidates } from '@/server/lib/model-roles/mock.server';
import type { ModelRoleCandidate } from '@/shared/types/model-roles';

const CANDIDATES_TTL_MS = 60_000;
const LIST_TIMEOUT_MS = 30_000;

/**
 * One `omp models --json` row → a candidate; null when the row is unusable.
 *
 * The row is read as an untyped record and every field is narrowed: the JSON is
 * produced by a binary this module does not compile against, so a missing or
 * retyped field must degrade the row, not the listing.
 */
function toCandidate(raw: unknown): ModelRoleCandidate | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const row: Record<string, unknown> = { ...raw };
  const provider = row.provider;
  const id = row.id;
  if (typeof provider !== 'string' || typeof id !== 'string') return null;
  const name = row.name;
  const kind = row.kind;
  const selector = row.selector;
  return {
    selector: typeof selector === 'string' ? selector : `${provider}/${id}`,
    id,
    name: typeof name === 'string' && name.trim() ? name : id,
    provider,
    kind: typeof kind === 'string' ? kind : 'chat',
  };
}

/** `omp models --json --kind all` → candidates; throws with omp's own sentence. */
async function readCandidatesFromCli(): Promise<ModelRoleCandidate[]> {
  const bin = resolveOmpBin();
  if (!bin) throw new Error('omp binary not found — install omp to pick role models');
  const proc = Bun.spawn({
    env: childEnv(),
    cmd: [bin, 'models', '--json', '--kind', 'all'],
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: LIST_TIMEOUT_MS,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const line = (stderr.trim() || stdout.trim()).split('\n').map((row) => row.trim()).find(Boolean);
    throw new Error(line ? line.replace(/^[^\w@/]*/, '') : `omp models exited with code ${exitCode}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error('omp models returned unexpected JSON');
  }
  const rows = typeof parsed === 'object' && parsed !== null && 'models' in parsed ? parsed.models : undefined;
  if (!Array.isArray(rows)) throw new Error('omp models returned no model list');
  return rows.flatMap((raw) => {
    const candidate = toCandidate(raw);
    return candidate ? [candidate] : [];
  });
}

/**
 * Candidates for the role dropdowns. A catalog failure is REPORTED rather than
 * thrown: the roles themselves live in config.yml and stay editable without it,
 * and an empty dropdown with no explanation reads as "no models exist".
 */
export async function readModelRoleCandidates(): Promise<{ candidates: ModelRoleCandidate[]; error: string | null }> {
  if (isMockMode()) return { candidates: mockRoleCandidates(), error: null };
  const cached = globalThis.__kabmoRoleCandidatesCache;
  if (cached && cached.expiresAt > Date.now()) return { candidates: cached.data, error: null };
  try {
    const candidates = await readCandidatesFromCli();
    globalThis.__kabmoRoleCandidatesCache = { data: candidates, expiresAt: Date.now() + CANDIDATES_TTL_MS };
    return { candidates, error: null };
  } catch (error) {
    return { candidates: [], error: error instanceof Error ? error.message : String(error) };
  }
}

