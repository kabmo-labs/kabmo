/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Discovery of omp's project-shared Chromium runtime state.
 *
 * For a project directory omp runs one broker-supervised browser daemon under
 * `~/.omp/run/daemons/<hash>/` (or `$XDG_STATE_HOME/omp/run/daemons/<hash>/`).
 * `scope.json` maps the runtime dir back to its project; `<daemon>.profile/
 * DevToolsActivePort` carries the live CDP port and WebSocket path; and
 * `<daemon>.targets/<ompPid>.json` lists the page target ids that the omp
 * process with that pid opened. This module only reads that state — it never
 * starts, mutates, or closes the browser.
 */

import { readdir, realpath } from 'fs/promises';
import * as path from 'path';
import { getConfigRoot } from '@/server/lib/omp/core/paths';

/** Candidate daemon names, in the order the viewer prefers them. */
const DAEMON_NAMES = ['omp.browser.headless', 'omp.browser.headed'] as const;

/** File Chromium writes next to its profile with the live CDP endpoint. */
const DEVTOOLS_ACTIVE_PORT = 'DevToolsActivePort';

interface ProjectRuntime {
  runtimeDir: string;
  daemonName: string;
  /** CDP TCP port (DevToolsActivePort line 1). */
  port: number;
  /** Browser-level CDP WebSocket URL: ws://127.0.0.1:<port><wsPath>. */
  wsUrl: string;
}

/** Resolve symlinks when possible; fall back to a plain absolute path. */
async function canonicalPath(value: string): Promise<string> {
  try {
    return await realpath(value);
  } catch {
    return path.resolve(value);
  }
}

/** Runtime-dir roots to scan: the config root always, XDG state when set. */
function candidateRoots(): string[] {
  const roots = [path.join(getConfigRoot(), 'run', 'daemons')];
  const stateHome = Bun.env.XDG_STATE_HOME?.trim();
  if (stateHome) roots.push(path.join(stateHome, 'omp', 'run', 'daemons'));
  return roots;
}

/**
 * TCP probe with a short timeout — Chromium writes DevToolsActivePort before
 * it starts listening, and the file survives a crash, so the port must be
 * checked before the endpoint is trusted.
 */
export async function isTcpPortLive(port: number, host = '127.0.0.1', timeoutMs = 750): Promise<boolean> {
  const socket = Bun.connect({
    hostname: host,
    port,
    socket: {
      data() {},
      close() {},
      error() {},
    },
  });
  // Bun.connect resolves to a TCPSocket on success and rejects with
  // "Failed to connect" when nothing listens — no timeout race needed for the
  // loopback case, but guard against a hung connect anyway.
  const opened = await Promise.race([
    socket.then(() => true, () => false),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ]);
  if (opened) await socket.then((s) => s.end());
  return opened;
}

/** Read a daemon's live CDP endpoint from its DevToolsActivePort file. */
async function readDaemonEndpoint(
  runtimeDir: string,
): Promise<{ daemonName: string; port: number; wsUrl: string } | null> {
  for (const daemonName of DAEMON_NAMES) {
    const file = path.join(runtimeDir, `${daemonName}.profile`, DEVTOOLS_ACTIVE_PORT);
    let raw: string;
    try {
      raw = await Bun.file(file).text();
    } catch {
      continue;
    }
    const [portLine = '', pathLine = ''] = raw.split('\n');
    const port = Number.parseInt(portLine.trim(), 10);
    const wsPath = pathLine.trim();
    if (!Number.isInteger(port) || port <= 0 || !wsPath) continue;
    // Stale file: Chromium crashed or was killed after writing it. Treat the
    // daemon as gone so callers report `browser-offline` instead of hanging.
    if (!(await isTcpPortLive(port))) continue;
    return { daemonName, port, wsUrl: `ws://127.0.0.1:${port}${wsPath}` };
  }
  return null;
}

/**
 * Find the runtime dir whose `scope.json` points at `cwd` and return its live
 * daemon endpoint, or null when the project has no running shared browser.
 */
export async function findProjectRuntimeDir(cwd: string): Promise<ProjectRuntime | null> {
  if (!cwd) return null;
  const target = await canonicalPath(cwd);
  for (const root of candidateRoots()) {
    let entries: string[];
    try {
      entries = await readdir(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const runtimeDir = path.join(root, entry);
      let scopeRaw: string;
      try {
        scopeRaw = await Bun.file(path.join(runtimeDir, 'scope.json')).text();
      } catch {
        continue;
      }
      let projectDir: unknown;
      try {
        projectDir = (JSON.parse(scopeRaw) as { projectDir?: unknown }).projectDir;
      } catch {
        continue;
      }
      if (typeof projectDir !== 'string' || projectDir.length === 0) continue;
      if ((await canonicalPath(projectDir)) !== target) continue;
      const endpoint = await readDaemonEndpoint(runtimeDir);
      if (endpoint) return { runtimeDir, ...endpoint };
    }
  }
  return null;
}

/**
 * Page target ids opened by the omp process with `pid`, in creation order.
 * Missing or malformed registry files degrade to an empty list.
 */
export async function readOwnedTargetIds(
  runtimeDir: string,
  daemonName: string,
  pid: number,
): Promise<string[]> {
  try {
    const raw = await Bun.file(path.join(runtimeDir, `${daemonName}.targets`, `${pid}.json`)).text();
    const parsed = JSON.parse(raw) as { pid?: unknown; targets?: unknown };
    // Guard against a recycled pid inheriting a dead process's registry file.
    if (parsed.pid !== pid) return [];
    if (!Array.isArray(parsed.targets)) return [];
    return parsed.targets.filter((target): target is string => typeof target === 'string');
  } catch {
    return [];
  }
}
