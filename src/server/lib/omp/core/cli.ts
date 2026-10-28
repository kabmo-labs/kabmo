/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Locating the user's installed `omp` CLI. Kabmo never embeds the
 * (Bun-only) @oh-my-pi SDK — every live-agent capability goes through the
 * omp binary, so its absence is a first-class, user-visible state.
 *
 * Faithful port of omp-web/lib/omp/omp-cli.ts (binary resolution only; the
 * version probe is not needed by Kabmo).
 */

import { existsSync } from 'fs';
import { homedir } from 'os';
import { delimiter, join } from 'path';

let cachedBin: string | null = null;
let binMissAt = 0;

const BIN_NAME = process.platform === 'win32' ? 'omp.exe' : 'omp';

// Only successes are cached for the process lifetime. omp may be installed (or
// PATH repaired) while the server runs; a permanently cached "not found" would
// keep the UI reporting a missing binary until restart.
const MISS_TTL_MS = 30_000;

/** Clear probes after an explicit `omp update` so the next request rechecks it. */
export function invalidateOmpCliCache(): void {
  cachedBin = null;
  binMissAt = 0;
}

function probeOmpBin(): string | null {
  const override = Bun.env.KABMO_OMP_BIN ?? Bun.env.OMPCHAMBER_OMP_BIN;
  if (override) return existsSync(override) ? override : null;

  const onPath = Bun.which(BIN_NAME);
  if (onPath) return onPath;

  // GUI-launched processes often miss homebrew/bun dirs in PATH; probe the
  // usual install locations before giving up.
  const fallbackPath = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    join(homedir(), '.bun', 'bin'),
    join(homedir(), '.local', 'bin'),
  ].join(delimiter);
  return Bun.which(BIN_NAME, { PATH: fallbackPath });
}

/** Resolve the omp binary: KABMO_OMP_BIN override, then PATH lookup. Returns
 * null when omp is not installed. A hit is cached for the process lifetime; a
 * miss is re-probed after MISS_TTL_MS. */
export function resolveOmpBin(): string | null {
  // A global Bun/npm update can replace or remove its launcher while this
  // server process is still alive. Never keep returning a stale cache entry.
  if (cachedBin && existsSync(cachedBin)) return cachedBin;
  cachedBin = null;
  if (Date.now() - binMissAt < MISS_TTL_MS) return null;
  const found = probeOmpBin();
  if (found) {
    cachedBin = found;
    binMissAt = 0;
    return found;
  }
  binMissAt = Date.now();
  return null;
}
