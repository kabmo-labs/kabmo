/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `omp models --json …` — the CLI's own model listing, as raw rows.
 *
 * Two settings surfaces need it and for the same reason: the RPC's
 * `get_available_models` answers CHAT models only (`modelRegistry.getAvailable()`
 * defaults to kind `chat`), so the role dropdowns and the provider panel both
 * have to ask the CLI to see an embedding, image, judge or rerank model at all.
 *
 * Only the spawn and the parse live here. Each caller caches its own projection
 * — the rows are 32 MB at the ceiling and the two shapes are different — and
 * both are dropped by the same `invalidateModelsCaches` signal.
 */

import { childEnv } from '@/server/lib/fs/child-env';
import { resolveOmpBin } from '@/server/lib/omp/core/cli';

const LIST_TIMEOUT_MS = 30_000;
const MAX_BUFFER = 32 * 1024 * 1024;

/** A raw row from the listing. Every field is narrowed by the caller. */
export type OmpModelsRow = Record<string, unknown>;

/**
 * Run `omp models --json <extra args>` and return its rows.
 *
 * `refresh` forces the online catalog re-fetch (`omp models refresh`), which is
 * the only way to ask omp to re-discover a provider: the RPC has no
 * provider-scoped refresh and the CLI's plain `ls` serves the cache.
 * Throws with omp's own first line so a caller can report it verbatim.
 */
export async function readOmpModelsJson(
  options: { refresh?: boolean; kind?: string } = {},
): Promise<OmpModelsRow[]> {
  const bin = resolveOmpBin();
  if (!bin) throw new Error('omp binary not found — install omp to read the model catalog');
  const args = ['models', ...(options.refresh ? ['refresh'] : []), '--json', '--kind', options.kind ?? 'all'];
  const proc = Bun.spawn({
    env: childEnv(),
    cmd: [bin, ...args],
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: LIST_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
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
  return rows.filter((row): row is OmpModelsRow => typeof row === 'object' && row !== null);
}
