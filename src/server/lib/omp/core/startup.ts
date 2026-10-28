/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Startup gate: Kabmo must not run without a resolvable `omp` binary.
 *
 * Every live capability — RPC agent sessions, config get/set, session state,
 * model lists, updates — shells out to that binary (see ./cli.ts), so a missing
 * install is not a degraded mode to browse into: the UI would open onto an
 * empty shell whose every action fails. Both entry points call this before
 * binding a port (src/server/index.ts) or spawning a detached server
 * (src/cli/lib/commands/serve.js), turning the failure into one actionable line
 * instead of a health check that never passes.
 *
 * `MOCK=true` is exempt by definition — demo mode exists to run on presets
 * without a real omp install.
 */

import { resolveOmpBin } from '@/server/lib/omp/core/cli';
import { getAgentDir, getConfigRoot } from '@/server/lib/omp/core/paths';
import { isMockMode } from '@/server/mock.server';

/** Null when the app may start; otherwise the message to print before exiting. */
export function ompStartupError(): string | null {
  if (isMockMode()) return null;
  if (resolveOmpBin()) return null;
  return [
    'omp binary not found — Kabmo cannot start.',
    'Agent sessions, omp config, session state and updates all run through the `omp` CLI,',
    'so the binary must be resolvable before the server starts.',
    'Install AI Oh-My-Pi and put `omp` on your PATH, or set KABMO_OMP_BIN=/path/to/omp.',
    'To run on demo data without an omp install, start with MOCK=true.',
  ].join('\n');
}

interface OmpStartupPaths {
  /** Resolved `omp` executable, or null when unresolved (mock mode). */
  bin: string | null;
  /** `~/.omp` — PI_CONFIG_DIR rename applied. */
  configDir: string;
  /** `~/.omp/agent` — PI_CODING_AGENT_DIR override applied. */
  agentDir: string;
}

/** Startup banner lines. The caller owns the prefix.
 *
 *  These are the locations the running process actually uses: the executable it
 *  spawns and the agent tree it reads. Printing them makes a misdirected install
 *  (two omps on PATH, a stray PI_CODING_AGENT_DIR) visible in the log instead of
 *  inferred from empty session lists. */
export function ompStartupLogLines(): string[] {
  const paths: OmpStartupPaths = {
    bin: resolveOmpBin(),
    configDir: getConfigRoot(),
    agentDir: getAgentDir(),
  };
  return [
    `omp binary:     ${paths.bin ?? 'not found (MOCK mode — presets only)'}`,
    `omp config dir: ${paths.configDir}`,
    `omp agent dir:  ${paths.agentDir}`,
  ];
}
