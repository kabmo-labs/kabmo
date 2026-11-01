/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The WRITE half of skill import: copying the skills a user picked out of a
 * cloned repository into a root Kabmo owns.
 *
 * The clone and the SKILL.md scan live in `skills-git-repo.ts`, because the
 * inspector and the installer must agree on what a repository contains — a
 * second scan here is how an installer copies a skill the list never showed.
 *
 * Every refusal is per skill, never per batch: one name that collides with an
 * installed skill (or one directory past the size cap) is reported in `skipped`
 * while the rest install, because a repository of twenty skills must not fail as
 * a whole over one collision.
 *
 * Two properties are load-bearing:
 *
 * - **The destination is always `<managed root>/<validated name>`.** Nothing is
 *   copied to a path the repository supplied: `safeSkillDirName` refuses a
 *   separator, and the source directory itself is re-derived from the scan and
 *   checked with `withinRoot` before it is read.
 * - **The source directory is copied WHOLE** (scripts, references, assets), not
 *   just its SKILL.md — a skill whose instructions point at `scripts/build.sh`
 *   is broken the moment only the markdown survives.
 */

import fs from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { invalidateSkillCache, managedSkillRoots } from '@/server/lib/omp/config/skills';
import { MAX_SKILL_DIR_BYTES } from '@/server/lib/omp/config/skills-git-repo';
import {
  scanSkillRepository,
  stageClone,
  toSkillRepoRef,
  withinRoot,
} from '@/server/lib/omp/config/skills-git-repo';

/** The directory a skill's name sanitises to, or a refusal. */
function safeSkillDirName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('A skill has no name');
  if (/[\\/]/.test(trimmed) || trimmed === '.' || trimmed === '..') {
    throw new Error(`Skill name refuses a path separator: ${trimmed}`);
  }
  return trimmed;
}

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) total += await dirSize(full);
    else if (entry.isFile()) total += await fs.promises.stat(full).then((s) => s.size).catch(() => 0);
    if (total > MAX_SKILL_DIR_BYTES) return total;
  }
  return total;
}

export interface InstallFromRepoOptions {
  scope: 'user' | 'project';
  projectDir?: string | null;
  /** A skill whose directory already exists is replaced, not skipped. */
  overwrite?: boolean;
  stagingParent?: string;
  /** Test seam: read from an existing directory instead of cloning. */
  sourceDir?: string;
}

export interface InstallFromRepoOutcome {
  installed: string[];
  skipped: Array<{ name: string; reason: string }>;
}

/**
 * Copy the picked skills out of `rawUrl` into a managed root. `wantedPaths` are
 * repo-relative paths exactly as the inspector reported them.
 */
export async function installSkillCopies(
  rawUrl: string,
  wantedPaths: string[],
  options: InstallFromRepoOptions,
): Promise<InstallFromRepoOutcome> {
  const ref = toSkillRepoRef(rawUrl);
  if (!ref) throw new Error('Expected a git URL or an owner/repo pair');
  if (options.scope === 'project' && !options.projectDir) {
    throw new Error('A workspace root is required to install a project skill');
  }

  const stagingParent = options.stagingParent ?? tmpdir();
  const staged = options.sourceDir
    ? { dir: options.sourceDir, cleanup: async () => {} }
    : await stageClone(ref.url, stagingParent);

  const installed: string[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];
  const wanted = new Set(wantedPaths);

  try {
    const entries = (await scanSkillRepository(staged.dir)).filter((entry) => wanted.has(entry.path));
    if (entries.length === 0) throw new Error('None of the selected skills are in that repository');

    const roots = managedSkillRoots(options.projectDir ?? null);
    const root = options.scope === 'project' ? roots[1] : roots[0];
    if (!root) throw new Error('A workspace root is required to install a project skill');

    for (const entry of entries) {
      const sourceDir = join(staged.dir, ...entry.path.split('/'));
      if (!withinRoot(staged.dir, sourceDir)) {
        skipped.push({ name: entry.name, reason: 'path is outside the repository' });
        continue;
      }
      let dirName: string;
      try {
        dirName = safeSkillDirName(entry.name);
      } catch (error) {
        skipped.push({ name: entry.name, reason: error instanceof Error ? error.message : String(error) });
        continue;
      }
      if (!entry.loadable) {
        skipped.push({ name: entry.name, reason: 'SKILL.md has no description, so omp will not load it' });
        continue;
      }

      const target = join(root, dirName);
      const exists = await fs.promises.stat(target).then((s) => s.isDirectory()).catch(() => false);
      if (exists && !options.overwrite) {
        skipped.push({ name: entry.name, reason: 'already installed — enable overwrite to replace it' });
        continue;
      }
      const size = await dirSize(sourceDir);
      if (size > MAX_SKILL_DIR_BYTES) {
        skipped.push({
          name: entry.name,
          reason: `skill directory is ${Math.round(size / 1024)} KB (limit ${MAX_SKILL_DIR_BYTES / 1024} KB)`,
        });
        continue;
      }

      if (exists) await fs.promises.rm(target, { recursive: true, force: true });
      await fs.promises.mkdir(root, { recursive: true });
      await fs.promises.cp(sourceDir, target, { recursive: true, force: true });
      installed.push(entry.name);
    }

    if (installed.length > 0) invalidateSkillCache();
    return { installed, skipped };
  } finally {
    await staged.cleanup();
  }
}
