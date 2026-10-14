/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * omp's daemon registry, read off disk.
 *
 * For each project omp runs a broker that supervises named daemons under
 * `~/.omp/run/daemons/<hash>/` (or `$XDG_STATE_HOME/omp/run/daemons/`):
 *
 * ```
 * <runtimeDir>/scope.json              {"projectDir": "/…"}
 * <runtimeDir>/broker.pid              {"pid": 62457}
 * <runtimeDir>/daemons/<name>/meta.json {"daemon":{"name","state","pid",…}}
 * ```
 *
 * Read here rather than through `omp ps --json`, and that is a measured choice:
 * the CLI costs a 455 ms spawn and reports only the REGISTERED daemons, while
 * these three files answer the same question with no process at all.
 *
 * **The broker is the entry point, not the daemon.** A daemon's pid is
 * registered, but the memory is in its descendants — the browser daemon's
 * registered pid is one Chromium process and its renderers are several more.
 * The classifier therefore labels the whole subtree, which is why the broker's
 * pid matters as much as each daemon's.
 *
 * **A broker can be parented OUTSIDE the chamber.** omp spawns it
 * `{ detached: true }` and then `unref()`s it, so a broker outlives the omp
 * process that started it and its ppid becomes 1. Measured on this machine: one
 * broker's parent was the server (reachable by a tree walk) and another's was
 * `1`, supervising this project's Chromium — 9 processes and ~470 MB a tree walk
 * from the server pid alone can never see. That is the whole reason this module
 * exists.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import type { DaemonEntry } from './classify';

/** omp's config dir name, honouring the documented rename. */
function configRoot(): string {
  const override = Bun.env.PI_CONFIG_DIR?.trim();
  return path.join(os.homedir(), override && override.length > 0 ? override : '.omp');
}

/**
 * Every root that may hold a daemon registry.
 *
 * Both, not either: omp's own `DirResolver` reads `$XDG_STATE_HOME/omp/run` when
 * the XDG layout is in use, and the plain config root otherwise. A host can have
 * both populated while an install migrates.
 */
function daemonRoots(): string[] {
  const roots = [path.join(configRoot(), 'run', 'daemons')];
  const stateHome = Bun.env.XDG_STATE_HOME?.trim();
  if (stateHome) roots.push(path.join(stateHome, 'omp', 'run', 'daemons'));
  return roots;
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // A missing or half-written file is a registry entry we do not have, which
    // is the same outcome as a daemon that is not running.
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

/** The pid in a `{"pid":N}` document, or null. */
function pidOf(value: unknown): number | null {
  const record = asRecord(value);
  const pid = record?.pid;
  return typeof pid === 'number' && Number.isInteger(pid) && pid > 0 ? pid : null;
}

/** One runtime dir's daemons, or an empty list when it is not a registry. */
function readRuntimeDir(runtimeDir: string): DaemonEntry[] {
  const scope = asRecord(readJson(path.join(runtimeDir, 'scope.json')));
  const projectDir = typeof scope?.projectDir === 'string' ? scope.projectDir : '';
  const brokerPid = pidOf(readJson(path.join(runtimeDir, 'broker.pid')));

  const daemonsDir = path.join(runtimeDir, 'daemons');
  let names: string[];
  try {
    names = fs.readdirSync(daemonsDir);
  } catch {
    return [];
  }

  const out: DaemonEntry[] = [];
  for (const name of names) {
    const meta = asRecord(readJson(path.join(daemonsDir, name, 'meta.json')));
    const daemon = asRecord(meta?.daemon);
    if (!daemon) continue;
    const pid = pidOf(daemon);
    if (pid === null) continue;
    out.push({
      name: typeof daemon.name === 'string' ? daemon.name : name,
      pid,
      state: typeof daemon.state === 'string' ? daemon.state : 'unknown',
      projectDir,
      brokerPid,
    });
  }
  return out;
}

/**
 * Every daemon omp reports, across every project on this machine.
 *
 * Deliberately not filtered by project: a daemon belongs to a *project's*
 * runtime dir, and the chamber serves one project at a time — but the brokers
 * that outlive their spawner are exactly the ones a project filter would drop
 * while they are still holding memory for a session the user has open. The
 * panel shows the project each entry belongs to, so a shared machine is
 * readable rather than silently merged.
 */
export function readDaemonRegistry(): DaemonEntry[] {
  const out: DaemonEntry[] = [];
  for (const root of daemonRoots()) {
    let dirs: string[];
    try {
      dirs = fs.readdirSync(root);
    } catch {
      continue;
    }
    for (const dir of dirs) {
      out.push(...readRuntimeDir(path.join(root, dir)));
    }
  }
  return out;
}
