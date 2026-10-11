#!/usr/bin/env bun

import packageJson from '@/../package.json';
import { parseArgs, helpText } from '@/cli/lib/args.js';
import { configure, error, fail } from '@/cli/lib/output.js';
import { resolvePath } from '@/cli/lib/path-utils.js';

const { version } = packageJson;

const COMMANDS = ['serve', 'update', 'stop', 'restart', 'status', 'logs', 'plugin'];

async function main() {
  const { command, positionals, options, unknown } = parseArgs(process.argv.slice(2));

  configure({ json: options.json, quiet: options.quiet });

  if (options.help || command === 'help') {
    process.stdout.write(helpText());
    return;
  }

  if (options.version) {
    process.stdout.write(`ompchamber ${version}\n`);
    return;
  }

  if (unknown.length > 0) {
    fail(`Unknown option: ${unknown[0]}\nRun "ompchamber --help" for usage.`);
  }

  // src/cli/ompchamber.js -> package root is two levels up.
  const pkgRoot = resolvePath(import.meta.dir, '..', '..');
  const ctx = { cwd: process.cwd(), pkgRoot, version };

  const name = command ?? 'serve';

  if (!COMMANDS.includes(name)) {
    error(`Unknown command: ${name}`);
    process.stderr.write(helpText());
    process.exit(1);
  }

  // Positionals travel on the options object as `args`: a command like
  // `plugin build <dir>` takes its operands that way, and a command that wants
  // none simply ignores the list. The alternative — a second parameter on every
  // `run` — would change six signatures for one caller.
  options.args = positionals;

  // Dynamic import keeps the CLI bootable even while a command module is
  // still being written by another process.
  const mod = await import(`./lib/commands/${name}.js`);

  if (typeof mod.run !== 'function') {
    fail(`Command "${name}" is unavailable (missing run()).`);
  }

  await mod.run(options, ctx);
}

main().catch((err) => {
  fail(err?.message ?? String(err));
});
