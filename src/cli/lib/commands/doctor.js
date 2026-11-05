// `kabmo doctor` — diagnose this install without changing anything.
//
// Read-only by construction: it resolves paths, asks `omp --version`, reads one
// npm document and lists live instances. It never opens the database (opening
// CREATES the file), never spawns a server and never writes a login entry.
//
// The command exists because the failure it explains is otherwise invisible:
// Kabmo refuses to start without an `omp` binary, and before this the only
// diagnostics were a one-paragraph refusal and `status`, which says nothing
// about omp at all.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { color, formatTable, isJson, log, printJson } from '@/cli/lib/output.js';
import { listLiveInstances, resolveBunBin } from '@/cli/lib/runtime.js';
import { resolveOmpBin } from '@/server/lib/omp/core/cli';
import { ompInstallCommands } from '@/server/lib/omp/core/install-hint';
import { getAgentDir, getConfigRoot } from '@/server/lib/omp/core/paths';
import { isMockMode } from '@/server/mock.server';
import { getDataDir } from '@/server/lib/lifecycle/paths';
import { checkOmpUpdate } from '@/server/lib/updates/omp';
import { resolveInstallContext, resolveKabmoVersion } from '@/server/lib/updates/install';

/** A path plus a dim note when it is not usable, so the report never implies a file exists. */
function presence(target) {
  try {
    return existsSync(target) ? target : `${target} ${color.dim('(missing)')}`;
  } catch {
    return `${target} ${color.dim('(unreadable)')}`;
  }
}

function bunVersion(bin) {
  if (!bin) return null;
  try {
    const proc = Bun.spawnSync({ cmd: [bin, '--version'], stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', timeout: 15_000 });
    return proc.exitCode === 0 ? proc.stdout.toString().trim() : null;
  } catch {
    return null;
  }
}

/** `resolveBunBin` throws when nothing answers `bun --version`; doctor reports that. */
function resolveBunOrNull() {
  try {
    return resolveBunBin();
  } catch {
    return null;
  }
}

function formatInstances(instances) {
  if (instances.length === 0) return 'none running';
  const ports = instances.map((entry) => entry.port).join(', ');
  return `${instances.length} running (port ${ports})`;
}

/** Every fact the report prints, so `--json` and the human table cannot disagree. */
export async function collectReport({ pkgRoot = process.cwd(), instances = null } = {}) {
  const bin = resolveOmpBin();
  const omp = await checkOmpUpdate();
  const kabmo = await resolveKabmoVersion(pkgRoot);
  const install = resolveInstallContext(pkgRoot);
  const bun = resolveBunOrNull();
  const live = instances ?? await listLiveInstances().catch(() => []);
  const dataDir = getDataDir();

  return {
    kabmo: {
      version: kabmo.current,
      latest: kabmo.latest,
      updateAvailable: kabmo.updateAvailable,
      package: install.pkgRoot,
      installMethod: install.method,
      reason: install.reason,
    },
    bun: { bin: bun, version: bunVersion(bun) },
    omp: {
      bin,
      installed: omp.installed,
      version: omp.current,
      latest: omp.latest,
      updateAvailable: omp.updateAvailable,
      error: omp.error,
      configDir: getConfigRoot(),
      agentDir: getAgentDir(),
    },
    data: { dir: presence(dataDir), database: presence(join(dataDir, 'db.sqlite')) },
    mock: isMockMode(),
    instances: live.map((entry) => ({ port: entry.port, pid: entry.pid, mode: entry.mode ?? null })),
  };
}

/**
 * Exit code: 1 only when Kabmo genuinely cannot run — no resolvable binary, or
 * a binary whose version cannot be read. A registry outage and a missing demo
 * database are notes, not failures; treating them as failures would make
 * `doctor` red on a healthy air-gapped install.
 */
export function exitCodeFor(report) {
  if (report.mock) return 0;
  if (!report.omp.bin) return 1;
  return report.omp.version ? 0 : 1;
}

function printHuman(report) {
  const rows = [
    ['kabmo', `${report.kabmo.version ?? 'unknown'}${report.kabmo.updateAvailable ? color.yellow(` (${report.kabmo.latest} available)`) : ''}`],
    ['  package', report.kabmo.package],
    ['  install', `${report.kabmo.installMethod} — ${report.kabmo.reason}`],
    ['bun', `${report.bun.version ?? 'unknown'} (${report.bun.bin})`],
    ['omp', report.omp.bin ?? color.red('not found')],
    ['  version', report.omp.version ?? color.red(report.omp.error ?? 'unknown')],
  ];
  if (report.omp.installed && report.omp.latest) {
    rows.push(['  latest', `${report.omp.latest}${report.omp.updateAvailable ? color.yellow(' (update available)') : ''}`]);
  }
  rows.push(
    ['  config', report.omp.configDir],
    ['  agent', report.omp.agentDir],
    ['data', report.data.dir],
    ['  database', report.data.database],
    ['mode', report.mock ? 'mock (demo presets)' : 'live (real omp data)'],
    ['instances', formatInstances(report.instances)],
  );
  log(formatTable(rows));
}

function printRemedy() {
  const { source, binary } = ompInstallCommands();
  log('');
  log('Kabmo needs your own `omp` binary — it does not install one for you.');
  log(`  bun:   ${source}`);
  log(`  or:    ${binary}`);
  log('Then check again: kabmo doctor');
}

export async function run(options, ctx) {
  const pkgRoot = ctx?.pkgRoot ?? process.cwd();
  const report = await collectReport({ pkgRoot });

  if (isJson()) {
    printJson(report);
    if (exitCodeFor(report) !== 0) process.exitCode = 1;
    return;
  }

  printHuman(report);
  if (!report.omp.bin) printRemedy();
  if (report.omp.error && report.omp.bin) log(color.red(`omp: ${report.omp.error}`));
  if (exitCodeFor(report) !== 0) process.exitCode = 1;
}
