// `kabmo logs` — print or follow the server logs.
//
// Scoping matches `status`/`stop`/`restart`: without `--port` the logs of every
// live instance are shown, each behind a `==> path <==` header, and `--port
// <port>` restricts the output to that instance. With nothing running, the log
// of the requested (or default) port is shown so a stopped server's output is
// still readable.

import { findLiveInstance, listLiveInstances } from '@/cli/lib/runtime.js';
import { getLogFilePath } from '@/cli/lib/paths.js';
import { log, warn, printJson, fail, isJson, isQuiet } from '@/cli/lib/output.js';
const DEFAULT_LINES = 50;
const FOLLOW_INTERVAL_MS = 300;

function resolvePort(options) {
  const raw = options?.port;
  if (raw !== null && raw !== undefined) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  const env = Bun.env.KABMO_PORT;
  if (typeof env === 'string' && env.trim().length > 0) {
    const parsed = Number(env.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return 3000;
}

function explicitPort(options) {
  const raw = options?.port;
  if (raw === null || raw === undefined) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function splitLines(content) {
  const lines = content.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function writeLines(lines) {
  for (const line of lines) {
    process.stdout.write(`${line}\n`);
  }
}

async function readTail(target, lineCount) {
  const content = await Bun.file(target.logFile).text();
  return { port: target.port, logFile: target.logFile, lines: splitLines(content).slice(-lineCount) };
}

/** Per-file read position, so following several logs keeps them independent. */
async function followFiles(targets, multiple) {
  const state = [];
  for (const target of targets) {
    let position = 0;
    try {
      position = (await Bun.file(target.logFile).stat()).size;
    } catch {
      position = 0;
    }
    state.push({ target, position });
  }

  let running = true;
  const stop = () => { running = false; };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  try {
    while (running) {
      await Bun.sleep(FOLLOW_INTERVAL_MS);
      for (const entry of state) {
        let size;
        try {
          size = (await Bun.file(entry.target.logFile).stat()).size;
        } catch {
          continue;
        }
        if (size < entry.position) entry.position = 0;
        if (size === entry.position) continue;

        if (multiple) process.stdout.write(`==> ${entry.target.logFile} <==\n`);
        const chunk = await Bun.file(entry.target.logFile).slice(entry.position, size).text();
        entry.position = size;
        process.stdout.write(chunk);
      }
    }
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}

export async function run(options) {
  const json = isJson();
  const quiet = isQuiet();
  const requested = explicitPort(options);
  const fallbackPort = requested ?? resolvePort(options);

  const instances = requested !== null
    ? [await findLiveInstance(requested)].filter(Boolean)
    : await listLiveInstances();

  const candidates = instances.length > 0
    ? instances.map((entry) => ({ port: entry.port, logFile: entry.logFile ?? getLogFilePath(entry.port) }))
    : [{ port: fallbackPort, logFile: getLogFilePath(fallbackPort) }];

  const targets = [];
  const skipped = [];
  for (const candidate of candidates) {
    if (await Bun.file(candidate.logFile).exists()) targets.push(candidate);
    else skipped.push(candidate);
  }
  if (targets.length === 0) {
    // A server started outside the CLI (`bun run dev`) logs to its own terminal,
    // so its recorded port has no file here even though it is very much alive.
    fail(skipped.length > 0 && instances.length > 0
      ? `No log file at ${skipped[0].logFile}.\nPort ${skipped[0].port} was not started by the CLI — its output goes to the terminal that started it.`
      : `No log file found at ${candidates[0].logFile}.\nStart the server first with \`kabmo serve\`.`);
  }

  const requestedLines = Number(options?.lines);
  const lineCount = Number.isFinite(requestedLines) && requestedLines > 0
    ? Math.trunc(requestedLines)
    : DEFAULT_LINES;

  if (json) {
    const tails = [];
    for (const target of targets) tails.push(await readTail(target, lineCount));
    printJson({ instances: tails, skipped: skipped.map((entry) => ({ port: entry.port, logFile: entry.logFile })) });
    return;
  }

  const multiple = targets.length > 1;
  if (!quiet) {
    log(multiple ? `Log files: ${targets.length} instances` : `Log file: ${targets[0].logFile}`);
    if (skipped.length > 0) {
      warn(`Skipped ${skipped.length} instance(s) without a CLI log file: port ${skipped.map((entry) => entry.port).join(', ')}`);
    }
  }

  for (const target of targets) {
    if (multiple) process.stdout.write(`==> ${target.logFile} <==\n`);
    writeLines(splitLines(await Bun.file(target.logFile).text()).slice(-lineCount));
  }

  if (options?.follow) await followFiles(targets, multiple);
}
