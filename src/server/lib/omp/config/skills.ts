/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Skill discovery and SKILL.md authoring for Kabmo's Skills settings.
 *
 * Discovery is delegated to `omp skill list <dir> --json` rather than
 * re-implemented here. omp's own resolver is the only thing that knows every
 * root it reads — `.omp/skills` (project walk-up), `~/.omp/agent/skills`,
 * `.claude`, `.agents`, `.codex`, `.github`, `.opencode`, plugin packages, the
 * skillshare store — plus the `skills.*` settings gates and the frontmatter
 * rules (`enabled: false`, a missing `description`, `hide`). A hand-rolled scan
 * of two directories silently disagreed with the agent: it listed skills the
 * agent could not run and hid the ones it could (measured: 6 shown vs 9 loaded
 * in this repository, and a catalog install into `~/.agents/skills` was
 * invisible to Kabmo while omp ran it happily).
 *
 * `omp skill list` is cheap (measured 0.38-0.42s, no session, no model) and is
 * cached per directory for a few seconds so a panel read or a settings reload
 * does not spawn a process per request.
 *
 * Writing is deliberately narrow: only the two roots Kabmo owns as
 * omp-native skills (`~/.omp/agent/skills` and `<workspace>/.omp/skills`) can
 * be created in, edited or deleted. A skill from another provider (a Claude
 * plugin, a registry package) is read-only here — Kabmo is not its
 * owner, and deleting a file another tool manages is not a "delete skill".
 */

import fs from 'fs';
import { join, resolve } from 'path';
import { getAgentDir, pathExists } from '@/server/lib/omp/core/paths';
import { resolveOmpBin } from '@/server/lib/omp/core/cli';
import { writeFileAtomic } from '@/server/lib/fs/atomic-write';
import { parseFrontmatter } from '@/server/lib/omp/config/yaml';
import { childEnv } from '@/server/lib/fs/child-env';

const MAX_SKILL_MD_BYTES = 512 * 1024;
const SKILL_LIST_TIMEOUT_MS = 30_000;
/** Discovery spawns a process, so a short cache absorbs the panel read and the
 *  composer's own fetch without ever serving a stale list for long. */
const CACHE_TTL_MS = 5_000;

export interface DiscoveredSkill {
  /** Stable id: `omp-<user|project>-<name>`. */
  id: string;
  name: string;
  description: string;
  /** omp's provider:level source, e.g. `native:user`, `agents:project`. */
  source: string;
  sourceRoot: 'user' | 'project';
  filePath: string;
  baseDir: string;
  /** Excluded from the model's skill listing (`hide` / disableModelInvocation). */
  hidden: boolean;
  /** True when Kabmo owns the files and may rewrite or remove them. */
  managed: boolean;
}

declare global {
  // eslint-disable-next-line no-var
  var __ompSkillListCache: Map<string, { at: number; skills: DiscoveredSkill[] }> | undefined;
}

function getCache(): Map<string, { at: number; skills: DiscoveredSkill[] }> {
  if (!globalThis.__ompSkillListCache) globalThis.__ompSkillListCache = new Map();
  return globalThis.__ompSkillListCache;
}

/** Drop the discovery cache so the next read reflects a write just made. */
export function invalidateSkillCache(): void {
  getCache().clear();
}

/**
 * The omp-native roots Kabmo may create, edit and delete in — and the
 * only directories a `delete` may touch. A skill folder sits directly under one
 * of these.
 */
export function managedSkillRoots(projectDir?: string | null): string[] {
  const roots = [join(getAgentDir(), 'skills')];
  if (projectDir) roots.push(join(projectDir, '.omp', 'skills'));
  return roots;
}

/** A skill Kabmo owns: omp-native AND sitting directly under a managed
 *  root. Everything else (a Claude plugin, a registry package) is read-only. */
function isManagedSkill(skill: { source: string; baseDir: string }, projectDir?: string | null): boolean {
  if (!skill.source.startsWith('native:')) return false;
  const parent = resolve(skill.baseDir, '..');
  return managedSkillRoots(projectDir).some((root) => resolve(root) === parent);
}

interface CliSkill {
  name?: unknown;
  description?: unknown;
  filePath?: unknown;
  baseDir?: unknown;
  source?: unknown;
  hide?: unknown;
}

/**
 * Enumerate the skills an omp session in `cwd` would load, through omp itself.
 * `projectDir` is the workspace the list is being shown for — it decides which
 * roots count as Kabmo-managed, and is NOT the same thing as `cwd` for the
 * user scope (whose cwd is the agent dir, which is not a workspace).
 * Returns [] when omp is not installed or the directory is unreadable; a
 * discovery failure must never surface as "you have no skills" being fatal.
 */
export async function discoverSkills(
  cwd?: string | null,
  projectDir?: string | null,
): Promise<DiscoveredSkill[]> {
  const bin = resolveOmpBin();
  if (!bin) return [];

  // A missing cwd falls back to the agent dir — the user scope — because that
  // is the only cwd whose inventory is a real scope rather than the server's
  // own working directory.
  const target = cwd && (await pathExists(cwd)) ? cwd : getAgentDir();
  const cache = getCache();
  const cached = cache.get(target);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.skills;

  const skills = await runSkillList(bin, target, projectDir ?? null);
  cache.set(target, { at: Date.now(), skills });
  return skills;
}

async function runSkillList(bin: string, cwd: string, projectDir: string | null): Promise<DiscoveredSkill[]> {
  let stdout: string;
  try {
    const proc = Bun.spawn({
      env: childEnv(),
      cmd: [bin, 'skill', 'list', cwd, '--json'],
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: SKILL_LIST_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    });
    const [out, err] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      console.error(`omp skill list failed (${exitCode}): ${err.trim().slice(0, 400)}`);
      return [];
    }
    stdout = out;
  } catch (error) {
    console.error(`omp skill list failed: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }

  let parsed: { skills?: unknown };
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed.skills)) return [];

  const result: DiscoveredSkill[] = [];
  for (const raw of parsed.skills as CliSkill[]) {
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    const filePath = typeof raw.filePath === 'string' ? raw.filePath : '';
    if (!name || !filePath) continue;
    const source = typeof raw.source === 'string' ? raw.source : 'native:user';
    const baseDir = typeof raw.baseDir === 'string' && raw.baseDir ? raw.baseDir : resolve(filePath, '..');
    result.push({
      id: `omp-${source.endsWith(':project') ? 'project' : 'user'}-${name}`,
      name,
      description: typeof raw.description === 'string' ? raw.description : '',
      source,
      sourceRoot: source.endsWith(':project') ? 'project' : 'user',
      filePath,
      baseDir,
      hidden: raw.hide === true,
      managed: isManagedSkill({ source, baseDir }, projectDir),
    });
  }
  return result;
}

/** Read one skill's SKILL.md, split into frontmatter data and body. */
export async function readSkillFile(
  filePath: string,
): Promise<{ description: string; body: string; hidden: boolean } | null> {
  try {
    const file = Bun.file(filePath);
    if (!(await file.exists()) || (await file.stat()).size > MAX_SKILL_MD_BYTES) return null;
    const text = await file.text();
    const { data, body } = parseFrontmatter(text);
    return {
      description: data.description ?? '',
      body: body.replace(/^\r?\n/, ''),
      hidden: data.disableModelInvocation === 'true' || data.hide === 'true',
    };
  } catch {
    return null;
  }
}

/** A skill name that is safe as a single directory component. */
function assertSafeName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Skill name is required');
  if (/[\\/]/.test(trimmed) || trimmed === '.' || trimmed === '..') {
    throw new Error('Skill name may not contain a path separator');
  }
  return trimmed;
}

/** Serialize a SKILL.md from its parts. `description` is mandatory for omp to
 *  load the skill at all, so it is always written as a frontmatter field. */
function serializeSkillMd(input: { name: string; description: string; hidden: boolean; body: string }): string {
  const lines = ['---', `name: ${JSON.stringify(input.name)}`, `description: ${JSON.stringify(input.description)}`];
  if (input.hidden) lines.push('disableModelInvocation: true');
  lines.push('---', '', input.body.replace(/\r\n/g, '\n').replace(/\s*$/, ''), '');
  return lines.join('\n');
}

export interface WriteSkillInput {
  /** Target root: `user` writes to the agent dir, `project` to the workspace. */
  scope: 'user' | 'project';
  /** Workspace root, required for `project`. */
  projectDir?: string | null;
  /** Base directory of the skill being edited, when it already exists. */
  previousDir?: string | null;
  name: string;
  description: string;
  hidden: boolean;
  body: string;
}

/** Create or overwrite a Kabmo-managed SKILL.md. Refuses a scope it cannot
 *  own (a project write with no workspace) rather than writing somewhere else. */
export async function writeSkillFile(input: WriteSkillInput): Promise<{ filePath: string }> {
  const name = assertSafeName(input.name);
  if (input.scope === 'project' && !input.projectDir) {
    throw new Error('A workspace root is required to write a project skill');
  }
  const root = input.scope === 'project' ? join(input.projectDir!, '.omp', 'skills') : join(getAgentDir(), 'skills');

  const dir = join(root, name);
  const filePath = join(dir, 'SKILL.md');

  // A rename or a scope move is a move: the old directory must not linger as a
  // second skill. It is removed only when it is a DIFFERENT directory inside a
  // managed root, so an edit in place never deletes the file just written and a
  // move across scopes cleans up the source.
  const previous = input.previousDir?.trim();
  if (previous) {
    const oldDir = resolve(previous);
    if (oldDir !== resolve(dir)) {
      const parent = resolve(oldDir, '..');
      if (managedSkillRoots(input.projectDir).some((candidate) => resolve(candidate) === parent)) {
        if (await pathExists(oldDir)) await fs.promises.rm(oldDir, { recursive: true, force: true });
      }
    }
  }

  await fs.promises.mkdir(dir, { recursive: true });
  await writeFileAtomic(
    filePath,
    serializeSkillMd({ name, description: input.description, hidden: input.hidden, body: input.body }),
    { createMode: 0o644 },
  );
  invalidateSkillCache();
  return { filePath };
}

/**
 * Delete a Kabmo-managed skill directory. Refused unless the target is an
 * omp-native skill sitting directly under a managed root, so a delete can never
 * reach a skill another tool installed.
 */
export async function deleteSkillDir(id: string, projectDir?: string | null): Promise<boolean> {
  // A user-scope delete (no workspace) is discovered from the agent dir, which
  // is also the only managed root that applies there.
  const found = (await discoverSkills(projectDir ?? getAgentDir(), projectDir)).find((skill) => skill.id === id);
  if (!found) return false;
  if (!found.managed) throw new Error(`"${found.name}" is managed by ${found.source}; Kabmo cannot delete it`);

  const dir = resolve(found.baseDir);
  const parent = resolve(dir, '..');
  if (!managedSkillRoots(projectDir).some((root) => resolve(root) === parent)) {
    throw new Error(`Refusing to delete outside the managed skill roots: ${dir}`);
  }
  if (!(await pathExists(dir))) return false;
  await fs.promises.rm(dir, { recursive: true, force: true });
  invalidateSkillCache();
  return true;
}

/**
 * Atomically toggle `disableModelInvocation` in a SKILL.md frontmatter —
 * read-modify-write via temp+rename, preserving the rest of the file. The
 * skill stays loadable through `skill://` and `/skill:<name>`; it only drops
 * out of the model's `<skills>` listing.
 */
export async function setSkillModelInvocation(filePath: string, disable: boolean): Promise<boolean> {
  try {
    const file = Bun.file(filePath);
    if (!(await file.exists()) || (await file.stat()).size > MAX_SKILL_MD_BYTES) return false;
    const text = await file.text();
    const flag = `disableModelInvocation: ${disable}`;
    let next: string;
    if (/^---\r?\n[\s\S]*?\r?\n---/.test(text)) {
      if (/^disableModelInvocation:/m.test(text)) {
        next = text.replace(/^disableModelInvocation:.*$/m, flag);
      } else {
        // Insert before the closing --- of the frontmatter.
        next = text.replace(/^---\r?\n([\s\S]*?)\r?\n---/, (full, front) => {
          void full;
          return `---\n${front}\n${flag}\n---`;
        });
      }
    } else {
      next = `---\n${flag}\n---\n\n${text}`;
    }
    if (next === text) return false;
    await writeFileAtomic(filePath, next);
    invalidateSkillCache();
    return true;
  } catch {
    return false;
  }
}
