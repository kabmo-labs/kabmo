/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Skill import from an arbitrary git repository.
 *
 * The catalog's registry path is `omp skill install @scope/name`, which only
 * resolves packages the Skillshare registry knows and tells the user nothing
 * about what is inside. A URL a user pastes is neither: it may hold one SKILL.md
 * at the root, twenty under `skills/`, or a plugin layout, and the user has to
 * see the list before anything lands on disk. So this module clones the
 * repository into a staging directory, reads the SKILL.md frontmatter itself,
 * and installs the entries the user picked.
 *
 * Three properties are load-bearing:
 *
 * - **The inspector is a clone, not a CLI listing.** A human-oriented tree has
 *   no machine shape to parse, and a CLI rewrite would break it; reading
 *   SKILL.md from a clone is the only shape that survives.
 * - **Everything is quoted as argv and path-joined through `join()`.** A skill
 *   name is author-chosen, so nothing here builds a shell string, and nothing
 *   copies a path the frontmatter supplied: a copy target is always
 *   `<root>/<validated name>`.
 * - **The clone is always removed.** A failed clone, a repository with no
 *   SKILL.md and a successful install all `rm -rf` the staging directory in a
 *   `finally`, because a leftover clone is a directory the next scan would have
 *   to reason about.
 *
 * This half CLONES and SCANS; `skills-git-install.ts` is the half that writes
 * into a managed root, and it imports the scanner rather than repeating it.
 */

import fs from 'fs';
import { tmpdir } from 'os';
import { dirname, join, relative, resolve, sep } from 'path';
import { gitRun, firstLine } from '@/server/lib/wiki/git';
import { parseFrontmatter } from '@/server/lib/omp/config/yaml';
import { repoSlug } from '@/shared/lib/git/url';
import type { GitSkillEntry } from '@/shared/types';

export const CLONE_TIMEOUT_MS = 120_000;
export const MAX_SKILL_ENTRIES = 60;
/** A skill directory is instructions plus optional scripts/assets. Past this it
 *  is not a skill Kabmo should silently copy. */
export const MAX_SKILL_DIR_BYTES = 5 * 1024 * 1024;
const MAX_SCAN_DEPTH = 4;
const MAX_SKILL_MD_BYTES = 512 * 1024;

/** A repo reference Kabmo is willing to hand to `git clone`. */
export interface SkillRepoRef {
  /** The URL exactly as git should receive it. */
  url: string;
  /** `owner/repo` for a GitHub URL, else the repo slug. Display and dedupe. */
  slug: string;
}

/**
 * Normalise what a user pasted into a clone URL.
 *
 * Accepts an https/ssh URL, the `git@host:owner/repo` form, a `github.com/owner/repo`
 * shorthand with no scheme, and a bare `owner/repo` pair — the last two are what
 * a catalog source card holds, and refusing them would mean the same repository
 * had to be written two different ways in two panes.
 */
export function toSkillRepoRef(raw: string): SkillRepoRef | null {
  const value = raw.trim().replace(/\/+$/, '');
  if (!value || /\s/.test(value)) return null;

  if (/^(https?|ssh|file):\/\/\S+$/i.test(value) || /^git@[^:/\s]+:\S+$/.test(value)) {
    return { url: value, slug: displaySlug(value) };
  }
  if (value.startsWith('/') || value.startsWith('~') || /^[a-z]:[\\/]/i.test(value)) {
    // A local path: git clones it, and a test fixtures directory is a real use
    // (an offline clone is the only way to exercise this offline). The key IS the
    // path — its last segment would make two different checkouts both named
    // "repo" one source, and the stored value is fed back to `git clone`, which
    // cannot resolve a bare directory name.
    return { url: value, slug: value };
  }

  const shorthand = value.replace(/^github\.com\//i, '');
  if (/^[\w.-]+\/[\w.-]+$/.test(shorthand)) {
    return { url: `https://github.com/${shorthand}.git`, slug: shorthand.replace(/\.git$/i, '') };
  }
  return null;
}

/**
 * `owner/repo` for a URL that has an owner, the last path segment otherwise.
 *
 * `repoSlug` answers the DIRECTORY name a clone takes, which is the repository
 * only — a catalog card that showed `skills` for `anthropics/skills` would name
 * a repository that does not exist.
 */
function displaySlug(url: string): string {
  const withoutScheme = url.replace(/^[a-z]+:\/\//i, '').replace(/^git@[^:]+:/i, '');
  const segments = withoutScheme.split('/').filter(Boolean);
  const tail = segments.slice(-2).map((part) => part.replace(/\.git$/i, ''));
  if (tail.length === 2 && !tail[0].includes(':')) return `${tail[0]}/${tail[1]}`;
  return repoSlug(url) || url;
}

export function withinRoot(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  return rel !== '' && !rel.startsWith('..') && !rel.startsWith(sep) && !rel.startsWith('/');
}

/** Directories a scan never descends into. A clone of a real repository is
 *  mostly these, and walking them costs seconds per inspection. */
const SKIP_DIRS: Record<string, true> = {
  node_modules: true,
  '.git': true,
  dist: true,
  build: true,
  out: true,
  coverage: true,
  vendor: true,
  '.next': true,
  target: true,
};

async function readSkillEntry(stagingDir: string, skillMdPath: string): Promise<GitSkillEntry | null> {
  const dir = dirname(skillMdPath);
  if (!withinRoot(stagingDir, dir)) return null;
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(skillMdPath);
  } catch {
    return null;
  }
  if (!stat.isFile() || stat.size > MAX_SKILL_MD_BYTES) return null;

  let text: string;
  try {
    text = await fs.promises.readFile(skillMdPath, 'utf8');
  } catch {
    return null;
  }
  const { data } = parseFrontmatter(text);
  const name = (data.name || dir.split(sep).pop() || '').trim();
  if (!name) return null;
  const description = (data.description || '').replace(/\s+/g, ' ').trim();
  return {
    path: relative(stagingDir, dir).split(sep).join('/'),
    name,
    description,
    // omp skips a SKILL.md with no description outright. Reporting such an entry
    // as installable would promise a skill that cannot run.
    loadable: description.length > 0,
  };
}

/** Collect `SKILL.md` files, `skills/*` first. A repository that keeps its
 *  skills at the top level (one SKILL.md at the root) and one that keeps them
 *  under `skills/` both resolve, and a nested plugin layout is reached by the
 *  bounded walk. */
async function scanSkillDirs(stagingDir: string): Promise<string[]> {
  const found: string[] = [];
  const seen = new Set<string>();
  const push = (file: string) => {
    const dir = dirname(file);
    if (seen.has(dir) || found.length >= MAX_SKILL_ENTRIES * 3) return;
    seen.add(dir);
    found.push(file);
  };

  const readdir = async (dir: string): Promise<fs.Dirent[]> => {
    try {
      return await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
  };

  const rootEntries = await readdir(stagingDir);
  for (const entry of rootEntries) {
    if (entry.isFile() && entry.name === 'SKILL.md') push(join(stagingDir, entry.name));
  }

  for (const preferred of ['skills', 'plugins', 'agents']) {
    const dir = join(stagingDir, preferred);
    if (!(await fs.promises.stat(dir).then((s) => s.isDirectory()).catch(() => false))) continue;
    for (const child of await readdir(dir)) {
      if (!child.isDirectory()) continue;
      const candidate = join(dir, child.name, 'SKILL.md');
      if (await fs.promises.stat(candidate).then((s) => s.isFile()).catch(() => false)) push(candidate);
    }
  }

  // Bounded walk for anything the conventional layouts did not cover.
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > MAX_SCAN_DEPTH || found.length >= MAX_SKILL_ENTRIES * 3) return;
    for (const child of await readdir(dir)) {
      if (found.length >= MAX_SKILL_ENTRIES * 3) return;
      if (!child.isDirectory() || child.name.startsWith('.') || Object.hasOwn(SKIP_DIRS, child.name)) continue;
      const next = join(dir, child.name);
      const candidate = join(next, 'SKILL.md');
      if (await fs.promises.stat(candidate).then((s) => s.isFile()).catch(() => false)) push(candidate);
      await walk(next, depth + 1);
    }
  };
  await walk(stagingDir, 1);
  return found;
}

/** Every skill a repository holds, in listing order. */
export async function scanSkillRepository(stagingDir: string): Promise<GitSkillEntry[]> {
  const files = await scanSkillDirs(stagingDir);
  const entries: GitSkillEntry[] = [];
  const names = new Set<string>();
  for (const file of files) {
    const entry = await readSkillEntry(stagingDir, file);
    if (!entry) continue;
    const key = `${entry.path}::${entry.name}`;
    if (names.has(key)) continue;
    names.add(key);
    entries.push(entry);
    if (entries.length >= MAX_SKILL_ENTRIES) break;
  }
  // Loadable entries first: a repository with three broken SKILL.md files and
  // one real skill should not lead with the broken ones.
  return entries.sort((a, b) => Number(b.loadable) - Number(a.loadable));
}

export interface InspectOptions {
  /** Where the repository is cloned. Defaults to the OS temp dir. */
  stagingParent?: string;
  /** Test seam: clone a directory that already exists instead of running git. */
  sourceDir?: string;
}

export async function stageClone(url: string, stagingParent: string): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const slug = repoSlug(url) || 'repo';
  const dir = join(stagingParent, `kabmo-skill-stage-${slug}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await fs.promises.rm(dir, { recursive: true, force: true });
  await fs.promises.mkdir(dirname(dir), { recursive: true });
  const clone = await gitRun(['clone', '--depth', '1', '--quiet', url, dir], { timeoutMs: CLONE_TIMEOUT_MS });
  const cleanup = async () => {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  };
  if (clone.failed || clone.exitCode !== 0) {
    await cleanup();
    const detail = firstLine(clone.stderr);
    if (/could not read Username|authentication failed|Permission denied/i.test(clone.stderr)) {
      throw new Error(`${detail || 'git clone failed'} — the repository needs credentials Kabmo cannot supply`);
    }
    throw new Error(detail || 'git clone failed');
  }
  return { dir, cleanup };
}

/**
 * Clone `url` into a staging directory, list its skills, and remove the clone.
 *
 * Errors are thrown with git's own first line, because "clone failed" tells the
 * user nothing about a typo in the owner name or a private repository.
 */
export async function inspectSkillRepo(
  rawUrl: string,
  options: InspectOptions = {},
): Promise<{ repo: string; skills: GitSkillEntry[]; notes: string[] }> {
  const ref = toSkillRepoRef(rawUrl);
  if (!ref) throw new Error('Expected a git URL or an owner/repo pair');

  if (options.sourceDir) {
    const skills = await scanSkillRepository(options.sourceDir);
    return { repo: ref.slug, skills, notes: [...(skills.length >= MAX_SKILL_ENTRIES ? [`Only the first ${MAX_SKILL_ENTRIES} skills are listed.`] : [])] };
  }

  const stagingParent = options.stagingParent ?? tmpdir();
  const staged = await stageClone(ref.url, stagingParent);
  try {
    const skills = await scanSkillRepository(staged.dir);
    const notes: string[] = [];
    if (skills.length === 0) notes.push('No SKILL.md found in this repository.');
    if (skills.length >= MAX_SKILL_ENTRIES) notes.push(`Only the first ${MAX_SKILL_ENTRIES} skills are listed.`);
    const unloadable = skills.filter((skill) => !skill.loadable).length;
    if (unloadable > 0) notes.push(`${unloadable} SKILL.md file(s) have no description, so omp would not load them.`);
    return { repo: ref.slug, skills, notes };
  } finally {
    await staged.cleanup();
  }
}

