// Linux tray host — a notification-area icon, owned by the server.
//
// Run as `bun <this file> <config.json>`. Bun rather than bash because the server
// already requires Bun, and because the notification protocol is a line
// conversation a shell would have to spawn a process per message to speak.
//
// The icon is drawn by the desktop's own notification-area client:
//
//   * `yad --notification --listen` is the first choice — it is the standard
//     scriptable tray on a freedesktop desktop and it speaks a documented
//     command protocol on stdin (`icon:`, `tooltip:`, `menu:`, `action:`,
//     `quit`), so this host is a client of it rather than a reimplementation.
//   * `zenity --notification --listen` is the same protocol and the second
//     choice, for a desktop that ships zenity but not yad.
//
// Neither is installed by default on every distribution, and no icon can be
// drawn without one — so a missing client is REPORTED (with the package to
// install) rather than silently skipped. The server keeps running either way:
// the tray is a convenience over the console, never a prerequisite for it.
//
// TWO LIFECYCLE RULES, matching the other two hosts:
//
//   1. The host is the SERVER's child and dies with it: `process.ppid` is polled
//      and the client is told to quit when it changes (the child is reparented
//      to init, so a killed server leaves no orphan icon).
//   2. Quit signals the SERVER (`process.kill(ppid, 'SIGTERM')`), so the icon
//      and the console it fronts end together.

import fs from 'node:fs';

/** The tray clients, in preference order, with the package that provides each. */
export const LINUX_TRAY_CLIENTS = [
  { bin: 'yad', pkg: 'yad' },
  { bin: 'zenity', pkg: 'zenity' },
];

function readConfig(path) {
  const parsed = JSON.parse(fs.readFileSync(path, 'utf8'));
  if (!parsed || typeof parsed.port !== 'number') throw new Error(`Invalid tray config: ${path}`);
  return parsed;
}

/** The notification client this desktop has, or null. */
function resolveClient() {
  for (const candidate of LINUX_TRAY_CLIENTS) {
    if (Bun.which(candidate.bin)) return candidate;
  }
  return null;
}

/**
 * The `menu:` payload the client renders.
 *
 * Item separator is `!` and the value separator `|` (yad's defaults, and
 * zenity's only spelling), so a label must not contain either. Actions are
 * `action:<id>` verbs the client echoes back on stdin, which is why the menu is
 * a list of ids rather than commands: nothing here builds a command line.
 */
export function menuPayload(model) {
  const entries = [];
  for (const item of model) {
    if (item.separator) {
      entries.push('');
      continue;
    }
    entries.push(`${String(item.title).replace(/[!|]/g, ' ')}!action:${item.id}`);
  }
  return entries.join('|');
}

/** The menu model — the same rows the other two hosts draw, as data. */
export function buildMenuModel(config) {
  return [
    { id: 'open', title: 'Open Console' },
    { id: 'logs', title: 'Open Logs' },
    { separator: true },
    { id: 'login', title: config.loginInstalled ? 'Disable Start at Login' : 'Start at Login' },
    { separator: true },
    { id: 'quit', title: 'Quit OMPChamber' },
  ];
}

/** Run one menu row. Returns false when it asked the host to exit. */
export function runAction(id, config) {
  if (id === 'open') {
    Bun.spawn({ cmd: ['xdg-open', config.url], stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' }).unref();
    return true;
  }
  if (id === 'logs') {
    Bun.spawn({ cmd: ['xdg-open', config.logFile], stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' }).unref();
    return true;
  }
  if (id === 'login') {
    const flag = config.loginInstalled ? '--no-startup' : '--startup';
    Bun.spawn({
      cmd: [config.bun, config.cli, 'serve', flag, '--port', String(config.port)],
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'ignore',
    }).unref();
    return true;
  }
  return false;
}

async function main() {
  const args = Bun.argv.slice(2);
  const config = readConfig(args.find((arg) => !arg.startsWith('-')) ?? '');
  const startPpid = process.ppid;

  const client = resolveClient();
  if (!client) {
    const packages = LINUX_TRAY_CLIENTS.map((entry) => entry.pkg).join(' or ');
    throw new Error(
      `No notification-area client found (tried ${LINUX_TRAY_CLIENTS.map((e) => e.bin).join(', ')}).\n`
      + `Install ${packages} to draw the tray icon. The console is running at ${config.url} either way.`,
    );
  }

  const proc = Bun.spawn({
    cmd: [
      client.bin,
      '--notification',
      '--listen',
      `--image=${config.icon}`,
      `--text=${config.label} · ${config.url}`,
      `--menu=${menuPayload(buildMenuModel(config))}`,
      '--no-middle',
    ],
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'inherit',
  });

  // The client prints one line per interaction: `clicked` for a left click, or
  // the `action:` verb of the row that was picked.
  const reader = (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of proc.stdout) {
      for (const line of decoder.decode(chunk).split('\n')) {
        const text = line.trim();
        if (!text) continue;
        if (text === 'clicked') {
          runAction('open', config);
          continue;
        }
        const id = text.startsWith('action:') ? text.slice('action:'.length) : text;
        if (id === 'quit' || !runAction(id, config)) {
          // Quit signals the SERVER, then ends the icon — the same order the
          // macOS host uses, so the console never outlives its tray.
          try {
            process.kill(startPpid, 'SIGTERM');
          } catch {
            // The server is already gone.
          }
          proc.kill();
          return;
        }
      }
    }
  })();

  // Parent watch: reparented to init means the server is gone, so the icon must
  // be too. Cheap enough to be invisible — one `process.ppid` read per tick.
  const watch = setInterval(() => {
    if (process.ppid !== startPpid) {
      proc.kill();
      clearInterval(watch);
      process.exit(0);
    }
  }, 2000);

  const code = await proc.exited;
  clearInterval(watch);
  void reader;
  process.exit(code);
}

// Only when this file IS the program. Without the guard, importing it — a test
// asserting the menu payload, or any future consumer — would read a config path
// out of the importing process's argv and start a tray.
if (Bun.argv[1]?.endsWith('linux.js')) {
  main().catch((error) => {
    process.stderr.write(`${error?.message ?? String(error)}\n`);
    process.exit(1);
  });
}
