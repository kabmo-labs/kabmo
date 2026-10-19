/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Where Kabmo's mode extension lives, and the spawn arguments that load
 * it.
 *
 * `extensions/kabmo-modes/` is the extension's own folder, mirroring the
 * repo's component convention (kebab-case folder, `index.ts` entry, suffix-only
 * child names) — and that is also what makes the RELATIVE imports inside it
 * legal: `-e <dir>/index.ts` resolves `./session` from the extension's own
 * directory, so nothing there may use Kabmo's `@/` alias (the child
 * process has no tsconfig for it).
 *
 * The extension ships WITH Kabmo (`extensions/`, next to `src/`) and is
 * passed to the child as `-e <abs path>`. It is deliberately not installed into
 * `~/.omp/agent/extensions/`:
 *
 *  - that directory is the USER's; writing there mutates their config,
 *  - its entries are toggleable from Settings → Extensions, so a stray click
 *    would silently disable the composer's mode toggles,
 *  - and an upgrade would leave the old copy behind, with the child loading
 *    whichever file the name happened to resolve to.
 *
 * An explicit `-e` is still honoured under `--no-extensions` (omp's own
 * documented behaviour), so a user who disables ambient extension discovery
 * keeps a working Plan/Goal toggle.
 *
 * Resolution walks up from this file, the same way `lib/assets/fonts.server.ts`
 * does, because the running layout differs between a checkout (cwd = repo root)
 * and the published bundle (`dist/client` as cwd, package root above it).
 */

import { existsSync } from 'node:fs';
import { dirname, join, parse, resolve } from 'node:path';

/** Absolute path of the extension entry, or null when the directory is absent
 *  (a pruned install). A null makes the spawn path skip `-e` entirely rather
 *  than pass a path omp would fail to load. */
import { CHAMBER_MODES_ENV, KABMO_MODES_ENV } from '@/shared/lib/omp/mode/types';

export function kabmoExtensionEntry(): string | null {
  // `kabmo-modes` is the folder this build ships; `chamber-modes` is the
  // pre-rename name, still probed so a checkout that upgraded in place (or a
  // package tree an older release left behind) keeps a working toggle rather
  // than silently spawning a child with no extension.
  const dirs = ['kabmo-modes', 'chamber-modes'];
  let dir = import.meta.dir;
  const { root } = parse(dir);
  for (;;) {
    for (const name of dirs) {
      const candidate = join(dir, 'extensions', name, 'index.ts');
      if (existsSync(candidate)) return candidate;
    }
    if (dir === root) break;
    dir = dirname(dir);
  }
  const cwd = resolve(process.cwd());
  for (const name of dirs) {
    const candidate = join(cwd, 'extensions', name, 'index.ts');
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Spawn arguments that load the mode extension. Empty when it cannot be
 *  found, so a pruned install still spawns a working (if toggle-less) child. */
export function kabmoExtensionArgs(): string[] {
  const entry = kabmoExtensionEntry();
  return entry ? ['-e', entry] : [];
}

/** Environment variables the extension reads at session start.
 *
 *  `KABMO_MODES` carries the persisted per-session selection. The pre-rename
 *  `CHAMBER_MODES` is ALSO exported, because the extension file on disk may
 *  still be the one that reads it — the two are written together for exactly one
 *  release's worth of installs, and the extension reads the new name first.
 *
 *  There used to be a second flag here (`CHAMBER_GOAL_AUTO_CONTINUE`) because
 *  the child armed its own loop; the loop belongs to Kabmo now, so the child has
 *  nothing to arm and the flag is gone. */
export function kabmoModeEnv(modes: { plan: boolean; goal: boolean }): Record<string, string> {
  const list = [modes.plan ? 'plan' : '', modes.goal ? 'goal' : ''].filter(Boolean);
  const value = list.join(',');
  return { [KABMO_MODES_ENV]: value, [CHAMBER_MODES_ENV]: value };
}

/** @deprecated Use `kabmoExtensionEntry`. */
export const chamberExtensionEntry = kabmoExtensionEntry;

/** @deprecated Use `kabmoExtensionArgs`. */
export const chamberExtensionArgs = kabmoExtensionArgs;

/** @deprecated Use `kabmoModeEnv`. */
export const chamberModeEnv = kabmoModeEnv;
