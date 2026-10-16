/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The JavaScript / TypeScript ecosystem.
 *
 * `package.json` is the one source here whose commands need something the file
 * does not carry: WHICH package manager runs them. That is `needsRunner`, and the
 * walk lives in `scan.ts` — the detector only formats the argv.
 *
 * `deno.jsonc`/`deno.json` declares `tasks` the same way, but the runner is never
 * ambiguous: `deno task` is the only thing that runs them.
 */

import { field, keys, cmd, type Detector } from './types';
import { parseJsonc } from './jsonc';
import type { Command } from '../../protocol';

/** `package.json` scripts: every key of `scripts`, through the resolved runner. */
function parsePackage(text: string, ctx: Parameters<Detector['parse']>[1]): Command[] {
  const scripts = field(parseJsonc(text), 'scripts');
  // Bun last: a runner that guessed `npm run` in a Bun repo would be wrong on the
  // repositories this user opens most (see `package-manager.ts`).
  const runner = ctx.runner ?? 'bun';
  return keys(scripts).map((name) => cmd(name, [runner, 'run', name]));
}

/** `deno.jsonc` / `deno.json` tasks. */
function parseDeno(text: string): Command[] {
  return keys(field(parseJsonc(text), 'tasks')).map((name) => cmd(name, ['deno', 'task', name]));
}

export const JS_DETECTORS: readonly Detector[] = [
  { kind: 'package', filenames: ['package.json'], needsRunner: true, parse: parsePackage },
  { kind: 'deno', filenames: ['deno.jsonc', 'deno.json'], parse: parseDeno },
];
