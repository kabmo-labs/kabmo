/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A per-session agent directory for omp's RPC mode, so one session's MCP list
 * can differ from every other session's.
 *
 * ## Why a directory
 *
 * `omp --mode rpc-ui` reads `mcp.json` from its agent dir ONCE at spawn and has
 * no RPC verb to add or remove a server. The only switch that changes which
 * file it reads is `PI_CODING_AGENT_DIR` — the same lever `utility-agent-dir.ts`
 * uses to spawn an MCP-free child. Measured on 18.20.0: a child pointed at an
 * overlay dir connected the server written there and ignored the real
 * `mcp.json`; `/mcp reload` re-read the overlay, so a toggle applies live.
 *
 * ## What the overlay contains
 *
 * Every entry of the real agent dir is SYMLINKED, so auth, models, sessions,
 * skills, extensions and the databases stay the one real copy — a session must
 * not fork its transcript or its credentials. The two MCP files are the
 * exception: `mcp.json` is written from the merged list (all sources, with this
 * session's enablement), and `.mcp.json` is not linked at all, because omp
 * unions both user files and a linked secondary would resurrect a server this
 * session disabled.
 *
 * Project config is switched off for the child with a `--config` overlay
 * (`mcp.enableProjectConfig: false`), because the project's own `mcp.json` is
 * read from the cwd and would otherwise add back a server the session disabled.
 * Measured on 18.20.0: with the overlay, a project server's command never ran;
 * without it, it did.
 *
 * ## Failure posture
 *
 * An overlay that cannot be built returns `undefined`, and the caller spawns
 * against the real agent dir: a session that starts with the configured list is
 * better than a chat that cannot start. The overlay is rebuilt on every spawn,
 * so a stale directory can never leak a previous list.
 */

import fs from 'fs';
import path from 'path';
import { tmpdir } from 'os';

import { getAgentDir } from '@/server/lib/omp/core/paths';
import { mcpServerEntriesFor } from '@/server/lib/mcp/registry.server';
import type { SessionMcpOverrides } from '@/server/lib/mcp/session-state.server';

/** The two files the overlay owns; everything else is a symlink. */
const OWNED_FILES: Record<string, true> = { 'mcp.json': true, '.mcp.json': true };

/** The `--config` overlay that keeps the project's own MCP file out of the child. */
const CONFIG_OVERLAY = 'kabmo-mcp.yml';

const OVERLAY_ROOT = 'kabmo-omp-session-mcp';

export interface SessionMcpOverlay {
  /** `PI_CODING_AGENT_DIR` for the child. */
  dir: string;
  /** The `--config` overlay path. */
  configPath: string;
}

/** The overlay directory for one session. Deterministic, so a respawn reuses it. */
export function sessionMcpOverlayDir(sessionId: string): string {
  const safe = sessionId.replace(/[^A-Za-z0-9._-]/g, '_');
  return path.join(tmpdir(), OVERLAY_ROOT, safe);
}

/**
 * Build (or rebuild) the overlay for a session and return it, or `undefined`
 * when the session has no overrides or the real agent dir cannot be read.
 *
 * A session with no overrides gets NO overlay: it reads the real `mcp.json`,
 * which is exactly the configured list, and pays no directory.
 */
export async function ensureSessionMcpOverlay(
  sessionId: string,
  cwd: string,
  overrides: SessionMcpOverrides,
  options: { keep?: boolean } = {},
): Promise<SessionMcpOverlay | undefined> {
  if (Object.keys(overrides).length === 0 && !options.keep) {
    await removeSessionMcpOverlay(sessionId);
    return undefined;
  }

  const real = getAgentDir();
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(real, { withFileTypes: true });
  } catch {
    return undefined;
  }

  const dir = sessionMcpOverlayDir(sessionId);
  // A misconfigured `PI_CODING_AGENT_DIR` that points at the overlay root would
  // make the rebuild delete the real agent dir. Refuse rather than risk it.
  if (path.resolve(real) === path.resolve(dir)) return undefined;
  try {
    await fs.promises.rm(dir, { recursive: true, force: true });
    await fs.promises.mkdir(dir, { recursive: true });
    for (const entry of entries) {
      if (OWNED_FILES[entry.name]) continue;
      try {
        await fs.promises.symlink(path.join(real, entry.name), path.join(dir, entry.name));
      } catch {
        // One unlinkable entry must not cost the whole overlay: the child still
        // boots, it just sees one fewer file.
      }
    }

    const servers = await mcpServerEntriesFor(cwd, {
      overrides,
      // Only the sources omp's RPC mode can actually read: its own `mcp.json`
      // files. App-local rows and plugin contributions are ACP-only today, and
      // materializing them here would silently change that delivery.
      sources: ['user', 'project'],
    });
    const mcpServers: Record<string, unknown> = {};
    for (const server of servers) {
      const config = { ...server.config };
      // Written explicitly in BOTH directions: a disabled entry must stay in
      // the file so `/mcp enable <name>` can find it, and an enabled one must
      // not inherit a stale `enabled: false` from the real config.
      if (server.enabled) delete config.enabled;
      else config.enabled = false;
      mcpServers[server.name] = config;
    }
    await fs.promises.writeFile(
      path.join(dir, 'mcp.json'),
      `${JSON.stringify({ mcpServers }, null, 2)}\n`,
    );
    const configPath = path.join(dir, CONFIG_OVERLAY);
    await fs.promises.writeFile(configPath, 'mcp:\n  enableProjectConfig: false\n');
    return { dir, configPath };
  } catch {
    await removeSessionMcpOverlay(sessionId);
    return undefined;
  }
}

/** Drop a session's overlay. Safe when there is none. */
export async function removeSessionMcpOverlay(sessionId: string): Promise<void> {
  try {
    await fs.promises.rm(sessionMcpOverlayDir(sessionId), { recursive: true, force: true });
  } catch {
    // A directory still in use by a live child: the next spawn rebuilds it.
  }
}
