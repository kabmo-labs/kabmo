import fs from 'node:fs';
import { getDataDir, getRunDir } from '@/server/lib/lifecycle/paths';
import { joinPath } from '@/cli/lib/path-utils.js';

/**
 * CLI-side paths.
 *
 * The data directory and the per-port run directory are owned by
 * `src/server/lib/lifecycle/paths` — the server writes its instance record
 * there, and the CLI must read the same file. Only the log location is
 * CLI-specific: the CLI redirects the daemon's stdout into it, so the server
 * never needs to know where the logs live.
 */

/**
 * Directory holding per-instance log files.
 */
export function getLogsDir() {
  const dir = joinPath(getDataDir(), 'logs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Log file for the running instance bound to `port`.
 */
export function getLogFilePath(port) {
  return joinPath(getLogsDir(), `kabmo-${port}.log`);
}

/**
 * Ensure the full data directory tree exists and return every path.
 */
export function ensureDataDirs() {
  return {
    dataDir: getDataDir(),
    runDir: getRunDir(),
    logsDir: getLogsDir(),
  };
}
