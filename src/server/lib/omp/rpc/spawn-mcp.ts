/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The MCP half of an omp session spawn.
 *
 * omp reads `mcp.json` once at start, so a session that overrode a server needs
 * its own agent dir (`PI_CODING_AGENT_DIR`) and a `--config` overlay that keeps
 * the project's own file out of the child. A session with no overrides gets
 * neither, and reads the real config exactly as before.
 *
 * Split out of `session-registry.ts` so the spawn plumbing stays under the
 * repo's per-file ceiling and the MCP rule reads as one unit.
 */

import { readSessionMcpOverrides } from '@/server/lib/mcp/session-state.server';
import { ensureSessionMcpOverlay, type SessionMcpOverlay } from '@/server/lib/mcp/session-overlay.server';

export interface SessionMcpSpawn {
  /** Extra CLI args for the child (`--config <overlay>`). */
  extraArgs: string[];
  /** The child's environment, with `PI_CODING_AGENT_DIR` when it has an overlay. */
  env?: Record<string, string>;
  /** The overlay the child was spawned with, for a live `/mcp reload`. */
  overlay?: SessionMcpOverlay;
}

export async function sessionMcpSpawn(
  sessionId: string,
  cwd: string,
  modeEnv: Record<string, string> | undefined,
): Promise<SessionMcpSpawn> {
  const overrides = await readSessionMcpOverrides(sessionId);
  const overlay = await ensureSessionMcpOverlay(sessionId, cwd, overrides);
  if (!overlay) return { extraArgs: [], env: modeEnv };
  return {
    extraArgs: ['--config', overlay.configPath],
    env: { ...(modeEnv ?? {}), PI_CODING_AGENT_DIR: overlay.dir },
    overlay,
  };
}
