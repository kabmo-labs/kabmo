/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * An MCP-free view of the agent directory, for the shared utility process.
 *
 * ## Why
 *
 * `omp --mode rpc-ui` connects every configured MCP server at startup, and the
 * child has no flag to skip them (`--no-tools` does not: measured, the codegraph
 * proxy still spawned). The utility pool only answers registry/auth/slash-command
 * queries — `get_available_models`, `get_login_providers`, `get_available_commands`,
 * `get_state`, `get_logout_accounts`/`logout` — and never runs an agent turn, so
 * the `codegraph serve --mcp` proxy plus its main-thread watchdog it spawned were
 * ~88 MB that served nothing. Verified by the `xd://` device notice: with MCP on,
 * omp mounts `mcp__codegraph_explore` into a child that can never call it.
 *
 * The only switch that measurably suppresses it is the agent directory itself:
 * `PI_CODING_AGENT_DIR` pointing at a directory with no `mcp.json` makes the
 * child spawn NO MCP process at all (measured `children=[]`), while every
 * utility command keeps answering — because each state file (models.yml,
 * auth.json, projects.json, the DBs) is symlinked through to the real one.
 *
 * ## Why symlinks, not copies
 *
 * A copy would fork state: `logout` writes credentials, `models.yml` is user
 * config, and the `.db` files are live SQLite with a WAL. Symlinking each entry
 * means the child reads and writes exactly the file the real agent dir uses, so
 * a logout through the utility child lands in the real auth storage. Directories
 * are symlinked too, not materialised empty: `skills/` holds the roots omp
 * DISCOVERS at startup, and an empty stand-in silently dropped every
 * `skill:<name>` entry from `get_available_commands` (measured 60 → 52
 * commands, 1 skill left). A write through a linked directory reaches the real
 * tree, which is exactly what the child does when it runs without an overlay.
 *
 * The one entry never linked is `mcp.json` — that is the whole point — and
 * `sessions/` is skipped because these children run `--no-session` and must not
 * create a second view of the session tree.
 *
 * ## Failure posture
 *
 * An overlay that cannot be built returns `undefined`, and the caller spawns
 * against the real agent dir: a slow registry query is better than a boot
 * failure, and MCP discovery is not worth failing a models list over. The
 * overlay is rebuilt per spawn (cheap: one readdir plus N symlinks) so an agent
 * dir that gains a file after boot is picked up by the next child.
 */

import fs from 'fs';
import path from 'path';
import { tmpdir } from 'os';

import { getAgentDir } from '@/server/lib/omp/core/paths';

/** Entries a child must never see from the overlay: the whole point, plus a
 *  session tree these `--no-session` children have no business mounting. */
const EXCLUDED: Record<string, true> = { 'mcp.json': true, sessions: true };

/** Prefix for the per-process overlay root, so a stale one is recognisable. */
const OVERLAY_PREFIX = 'kabmo-omp-utility-';

function overlayRoot(): string {
  return path.join(tmpdir(), `${OVERLAY_PREFIX}${process.pid}`);
}

/** Narrow the only field read from a failed `fs` call. */
function errorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return undefined;
}

/**
 * Build (idempotently) the MCP-free agent directory and return its path.
 *
 * Returns `undefined` when the real agent dir cannot be read — the caller then
 * uses the real dir, which trades the saved processes for a working child.
 */
export async function ensureUtilityAgentDir(): Promise<string | undefined> {
  const real = getAgentDir();
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(real, { withFileTypes: true });
  } catch {
    return undefined;
  }

  const root = overlayRoot();
  try {
    await fs.promises.mkdir(root, { recursive: true });
    for (const entry of entries) {
      if (EXCLUDED[entry.name]) continue;
      const target = path.join(root, entry.name);
      try {
        await fs.promises.symlink(path.join(real, entry.name), target);
      } catch (error) {
        // EEXIST: a previous spawn in this process already linked it. Any other
        // failure skips THIS entry rather than failing the whole overlay; the
        // child still boots, it just sees one fewer file.
        if (errorCode(error) !== 'EEXIST') continue;
      }
    }
    return root;
  } catch {
    return undefined;
  }
}

/**
 * Remove this process's overlay. Called from the utility pool's shutdown paths
 * so a long-lived server does not accumulate one directory per restart; a
 * removed overlay is rebuilt on the next spawn, so this is safe at any time.
 *
 * Only symlinks and directories are removed — never a file the child created
 * that might hold credentials.
 */
export async function removeUtilityAgentDir(): Promise<void> {
  const root = overlayRoot();
  try {
    const entries = await fs.promises.readdir(root, { withFileTypes: true });
    await Promise.all(entries.map(async (entry) => {
      const full = path.join(root, entry.name);
      try {
        // unlink removes a symlink itself, never its target.
        await (entry.isDirectory() ? fs.promises.rmdir(full) : fs.promises.unlink(full));
      } catch {
        // A directory with content (omp created files in a writable mount) or a
        // file the child owns: leave it. The next boot reuses the same path.
      }
    }));
    await fs.promises.rmdir(root);
  } catch {
    // Nothing to remove, or a directory still in use by a live child.
  }
}
