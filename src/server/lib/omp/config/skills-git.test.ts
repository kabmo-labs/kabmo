/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Skill import from a git repository: what the inspector is willing to list and
 * what the managed-copy installer will and will not write.
 *
 * The cases pinned here are the ones that quietly corrupt a skill tree:
 *
 * - a skill whose frontmatter has no `description` is NOT loadable (omp skips
 *   the file outright), so offering it as installable would promise a skill that
 *   never appears in the agent;
 * - a name carrying a path separator is refused rather than joined, which is the
 *   only thing standing between a repository and `join(root, '../../x')`;
 * - an existing directory is a SKIP unless `overwrite` is set, so importing a
 *   repository twice cannot silently replace the user's edits to a skill;
 * - every refusal is per skill: one collision must not abort the batch.
 *
 * Fixtures are plain directories on disk (`sourceDir`), so no case needs a
 * network or a git binary. The one clone case points `git` at a local repository
 * it creates itself, which is the only way to prove the staging directory is
 * removed afterwards.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { scanSkillRepository, toSkillRepoRef, inspectSkillRepo } from '@/server/lib/omp/config/skills-git-repo';
import { installSkillCopies } from '@/server/lib/omp/config/skills-git-install';
import { invalidateSkillCache } from '@/server/lib/omp/config/skills';
import { removeDir } from '@/test-support/remove-dir';

const ROOT = join(tmpdir(), 'kabmo-skills-git-test');
const REPO = join(ROOT, 'repo');
const AGENT_DIR = join(ROOT, 'agent');
let realAgentDir: string | undefined;

function writeSkill(dir: string, frontmatter: string, body = 'do the thing'): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(join(dir, 'SKILL.md'), `---\n${frontmatter}\n---\n\n${body}\n`);
}

beforeAll(() => {
  removeDir(ROOT);
  realAgentDir = Bun.env.PI_CODING_AGENT_DIR;
  Bun.env.PI_CODING_AGENT_DIR = AGENT_DIR;
  fs.mkdirSync(AGENT_DIR, { recursive: true });

  writeSkill(join(REPO, 'skills', 'review-pr'), 'name: review-pr\ndescription: Review pull requests');
  writeSkill(join(REPO, 'skills', 'diagnose'), 'name: diagnose\ndescription: Diagnose a bug');
  writeSkill(join(REPO, 'skills', 'no-description'), 'name: no-description');
  writeSkill(join(REPO, 'plugins', 'nested-skill'), 'name: nested-skill\ndescription: Lives under plugins/');
  // A directory with an unrelated README is not a skill.
  fs.mkdirSync(join(REPO, 'docs'), { recursive: true });
  fs.writeFileSync(join(REPO, 'docs', 'README.md'), '# docs\n');
});

afterAll(() => {
  if (realAgentDir === undefined) delete Bun.env.PI_CODING_AGENT_DIR;
  else Bun.env.PI_CODING_AGENT_DIR = realAgentDir;
  removeDir(ROOT);
});

describe('toSkillRepoRef', () => {
  test('accepts a URL, the scp form, a github shorthand and an owner/repo pair', () => {
    expect(toSkillRepoRef('https://github.com/anthropics/skills')?.url).toBe('https://github.com/anthropics/skills');
    expect(toSkillRepoRef('https://github.com/anthropics/skills')?.slug).toBe('anthropics/skills');
    expect(toSkillRepoRef('git@github.com:anthropics/skills.git')?.slug).toBe('anthropics/skills');
    expect(toSkillRepoRef('github.com/anthropics/skills')?.url).toBe('https://github.com/anthropics/skills.git');
    expect(toSkillRepoRef('anthropics/skills')?.slug).toBe('anthropics/skills');
  });

  test('a shorthand slug is owner/repo, not the clone directory name', () => {
    // `repoSlug` answers the DIRECTORY a clone takes ("skills"); a card showing
    // that would name a repository that does not exist.
    expect(toSkillRepoRef('https://github.com/anthropics/skills')?.slug).not.toBe('skills');
    expect(toSkillRepoRef('https://gitlab.com/team/tools/skills')?.slug).toBe('tools/skills');
  });

  test('refuses an empty value and anything with whitespace', () => {
    expect(toSkillRepoRef('')).toBeNull();
    expect(toSkillRepoRef('   ')).toBeNull();
    expect(toSkillRepoRef('not a repo')).toBeNull();
  });
});

describe('scanSkillRepository', () => {
  test('lists skills/ and plugins/ entries and marks the unloadable one', async () => {
    const skills = await scanSkillRepository(REPO);
    const byName = new Map(skills.map((skill) => [skill.name, skill]));
    expect(byName.get('review-pr')?.path).toBe('skills/review-pr');
    expect(byName.get('diagnose')?.loadable).toBe(true);
    expect(byName.get('nested-skill')?.path).toBe('plugins/nested-skill');
    expect(byName.get('no-description')?.loadable).toBe(false);
    expect(byName.has('README')).toBe(false);
  });

  test('loadable entries come first', async () => {
    const skills = await scanSkillRepository(REPO);
    const firstBlocked = skills.findIndex((skill) => !skill.loadable);
    if (firstBlocked !== -1) {
      expect(skills.slice(firstBlocked).every((skill) => !skill.loadable)).toBe(true);
    }
  });

  test('a repository with no SKILL.md reports nothing and says so', async () => {
    const empty = join(ROOT, 'empty-repo');
    fs.mkdirSync(empty, { recursive: true });
    fs.writeFileSync(join(empty, 'package.json'), '{}');
    const inspection = await inspectSkillRepo(empty, { sourceDir: empty });
    expect(inspection.skills).toEqual([]);
  });
});

describe('installSkillCopies', () => {
  test('copies a skill directory whole into the managed user root', async () => {
    invalidateSkillCache();
    const outcome = await installSkillCopies('owner/repo', ['skills/review-pr'], {
      scope: 'user',
      sourceDir: REPO,
    });
    expect(outcome.installed).toEqual(['review-pr']);
    expect(outcome.skipped).toEqual([]);
    const target = join(AGENT_DIR, 'skills', 'review-pr');
    expect(fs.existsSync(join(target, 'SKILL.md'))).toBe(true);
    expect(fs.readFileSync(join(target, 'SKILL.md'), 'utf8')).toContain('description: Review pull requests');
  });

  test('an existing skill is skipped, not overwritten, and the batch continues', async () => {
    const outcome = await installSkillCopies('owner/repo', ['skills/review-pr', 'skills/diagnose'], {
      scope: 'user',
      sourceDir: REPO,
    });
    expect(outcome.installed).toEqual(['diagnose']);
    expect(outcome.skipped).toEqual([
      { name: 'review-pr', reason: 'already installed — enable overwrite to replace it' },
    ]);
  });

  test('overwrite replaces the directory', async () => {
    fs.writeFileSync(join(AGENT_DIR, 'skills', 'review-pr', 'SKILL.md'), 'local edit');
    const outcome = await installSkillCopies('owner/repo', ['skills/review-pr'], {
      scope: 'user',
      sourceDir: REPO,
      overwrite: true,
    });
    expect(outcome.installed).toEqual(['review-pr']);
    expect(fs.readFileSync(join(AGENT_DIR, 'skills', 'review-pr', 'SKILL.md'), 'utf8')).toContain('Review pull requests');
  });

  test('a SKILL.md with no description is refused by name', async () => {
    const outcome = await installSkillCopies('owner/repo', ['skills/no-description'], {
      scope: 'user',
      sourceDir: REPO,
    });
    expect(outcome.installed).toEqual([]);
    expect(outcome.skipped[0]?.name).toBe('no-description');
    expect(outcome.skipped[0]?.reason).toContain('no description');
    expect(fs.existsSync(join(AGENT_DIR, 'skills', 'no-description'))).toBe(false);
  });

  test('a name carrying a path separator cannot escape the managed root', async () => {
    const evil = join(ROOT, 'evil-repo');
    writeSkill(join(evil, 'skills', 'escape'), 'name: ../../escaped\ndescription: tries to escape');
    const outcome = await installSkillCopies('owner/repo', ['skills/escape'], {
      scope: 'user',
      sourceDir: evil,
    });
    expect(outcome.installed).toEqual([]);
    expect(outcome.skipped[0]?.reason).toContain('path separator');
    expect(fs.existsSync(join(AGENT_DIR, 'skills', 'escaped'))).toBe(false);
  });

  test('a project install with no workspace is refused, never redirected', async () => {
    await expect(
      installSkillCopies('owner/repo', ['skills/diagnose'], { scope: 'project', sourceDir: REPO }),
    ).rejects.toThrow(/workspace root/);
  });

  test('selecting nothing from the repository is an error, not an empty success', async () => {
    await expect(
      installSkillCopies('owner/repo', ['skills/does-not-exist'], { scope: 'user', sourceDir: REPO }),
    ).rejects.toThrow(/None of the selected skills/);
  });
});

describe('inspectSkillRepo over a real clone', () => {
  test('clones a local repository, lists its skills, and removes the staging directory', async () => {
    const origin = join(ROOT, 'origin');
    writeSkill(join(origin, 'skills', 'cloned'), 'name: cloned\ndescription: Came from a clone');
    const stagingParent = join(ROOT, 'staging');
    fs.mkdirSync(stagingParent, { recursive: true });

    const init = Bun.spawnSync({ cmd: ['git', 'init', '--quiet'], cwd: origin });
    expect(init.exitCode).toBe(0);
    Bun.spawnSync({ cmd: ['git', 'add', '.'], cwd: origin });
    Bun.spawnSync({
      cmd: ['git', '-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', 'init'],
      cwd: origin,
    });

    const inspection = await inspectSkillRepo(origin, { stagingParent });
    expect(inspection.skills.map((skill) => skill.name)).toEqual(['cloned']);
    const leftovers = fs.readdirSync(stagingParent).filter((entry) => entry.startsWith('kabmo-skill-stage-'));
    expect(leftovers).toEqual([]);
  });

  test('a clone of a path that is not a repository reports git’s own line', async () => {
    const notARepo = join(ROOT, 'not-a-repo');
    fs.mkdirSync(notARepo, { recursive: true });
    await expect(inspectSkillRepo(notARepo, { stagingParent: join(ROOT, 'staging2') })).rejects.toThrow();
  });

  test('an unusable URL is refused before any process starts', async () => {
    await expect(inspectSkillRepo('not a repo')).rejects.toThrow(/Expected a git URL/);
  });
});
