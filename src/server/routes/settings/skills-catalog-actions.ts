/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Skills Catalog's git actions: sources, inspection and install.
 *
 * Split from the skill CRUD route (which is already the largest module in
 * `settings/`) because these two families answer different questions. A CRUD
 * request names a skill Kabmo already discovered; a catalog request names a
 * repository Kabmo has never seen, and its answer is a LIST of skills plus what
 * the server refuses to install.
 *
 * Three refusals are load-bearing:
 *
 * - **A duplicate repository is a 409, not a second card.** Two cards for one
 *   repository mean two `skillCount`s and two scan buttons that disagree.
 * - **A project install with no workspace is refused**, never redirected to the
 *   user root: the user picked a scope, and landing the files elsewhere is how a
 *   skill "vanishes" from the list being viewed.
 * - **A registry install is one `bunx skills add --skill <name>` per picked
 *   skill**, and a failure is reported per skill. The CLI has no batch form that
 *   names individual skills, and an unscoped add installs the whole repository
 *   (measured: 20 directories for one click).
 */

import { json } from '@/server/lib/remix-compat';
import { isMockMode } from '@/server/mock.server';
import type { DiscoveryScope } from '@/server/lib/omp/config/scope';
import type { SkillCatalogSource } from '@/shared/types';
import { DEFAULT_CATALOG_SKILLS } from '@/client/data/settings/skill';
import { searchSkillCatalog, toCatalogSkills, installCatalogSkill } from '@/server/lib/omp/config/skills-catalog';
import { inspectSkillRepo, toSkillRepoRef } from '@/server/lib/omp/config/skills-git-repo';
import { installSkillCopies } from '@/server/lib/omp/config/skills-git-install';
import { readCatalogSources, writeCatalogSources } from '@/server/lib/omp/config/skill-sources';
import type { DbClient } from '@/server/lib/db/client';
import { reloadLiveSessions } from '@/server/lib/omp/session/reload.server';

export interface CatalogDeps {
  db: DbClient;
  scope: DiscoveryScope;
  /**
   * True only when the request actually NAMED a workspace root.
   *
   * `resolveDiscoveryScope` answers the server's own cwd for a request with no
   * `root` — which is correct for a read (omp is asked about the directory it
   * would spawn in) and wrong for an install: the catalog pane sends no root, so
   * a `project` default wrote the copied skill into the server's working
   * directory. Measured: a UI install landed in `<repo>/.omp/skills/new-skill`
   * while the user was looking at a user-scope list.
   */
  hasWorkspace: boolean;
  /** The live discovery list, re-read after a write. */
  listSkills: (scope: DiscoveryScope) => Promise<{ name: string }[]>;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Handle one catalog action. Returns `null` when `type` is not a catalog action,
 * so the caller can fall through to the skill CRUD branches.
 */
export async function runCatalogAction(body: Record<string, unknown>, deps: CatalogDeps): Promise<Response | null> {
  const mock = isMockMode();
  const { db, scope } = deps;
  const type = typeof body.type === 'string' ? body.type : '';

  if (type === 'add_source') {
    const ref = toSkillRepoRef(typeof body.repo === 'string' ? body.repo : '');
    if (!ref) return json({ error: 'Expected a git URL or an owner/repo pair' }, { status: 400 });
    const sources = await readCatalogSources(db);
    if (sources.some((source) => source.repo === ref.slug)) {
      return json({ error: `${ref.slug} is already a source` }, { status: 409 });
    }
    const source: SkillCatalogSource = {
      id: `custom-${Date.now().toString(36)}`,
      name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : ref.slug,
      repo: ref.slug,
      skillCount: null,
      scannedAt: null,
      isCustom: true,
    };
    const updated = [...sources, source];
    await writeCatalogSources(db, updated);
    return json({ success: true, catalogSources: updated, source });
  }

  if (type === 'remove_source') {
    const id = typeof body.id === 'string' ? body.id : '';
    if (!id) return json({ error: 'id is required' }, { status: 400 });
    const sources = await readCatalogSources(db);
    const updated = sources.filter((source) => source.id !== id);
    if (updated.length === sources.length) return json({ error: 'Source not found' }, { status: 404 });
    await writeCatalogSources(db, updated);
    return json({ success: true, catalogSources: updated });
  }

  // Real search over skills.sh. The Browse box used to filter the ~26 entries the
  // loader had pre-fetched, so a query the catalog actually held answered "no
  // skills found".
  if (type === 'search_catalog') {
    const query = typeof body.q === 'string' ? body.q.trim() : '';
    if (!query) return json({ query, catalogSkills: [] });
    if (mock) {
      const needle = query.toLowerCase();
      return json({
        query,
        catalogSkills: DEFAULT_CATALOG_SKILLS.filter((skill) =>
          `${skill.name} ${skill.description} ${skill.repoTag}`.toLowerCase().includes(needle),
        ),
      });
    }
    const seen = new Set<string>();
    const catalogSkills = toCatalogSkills(await searchSkillCatalog(query, 24), 'skills-sh').filter((item) =>
      seen.has(item.repoTag) ? false : (seen.add(item.repoTag), true),
    );
    return json({ query, catalogSkills });
  }

  if (type === 'inspect_git_repo' || type === 'scan_source') {
    if (mock) return json({ error: 'Repository inspection is unavailable in mock mode' }, { status: 409 });

    let repo: string;
    let previous: SkillCatalogSource[] = [];
    let sourceId: string | null = null;
    if (type === 'scan_source') {
      const id = typeof body.id === 'string' ? body.id : '';
      previous = await readCatalogSources(db);
      const source = previous.find((candidate) => candidate.id === id);
      if (!source) return json({ error: 'Source not found' }, { status: 404 });
      repo = source.repo;
      sourceId = id;
    } else {
      repo = typeof body.url === 'string' ? body.url : '';
    }

    const inspection = await inspectSkillRepo(repo);
    const installed = new Set((await deps.listSkills(scope)).map((skill) => skill.name));
    const skills = inspection.skills.map((skill) => ({ ...skill, installed: installed.has(skill.name) }));
    if (!sourceId) return json({ ...inspection, skills });

    // A stored count must come from a scan: this is the only place one is written.
    const updated = previous.map((candidate) =>
      candidate.id === sourceId
        ? { ...candidate, skillCount: skills.filter((skill) => skill.loadable).length, scannedAt: Date.now() }
        : candidate,
    );
    await writeCatalogSources(db, updated);
    return json({ ...inspection, skills, sourceId, catalogSources: updated });
  }

  if (type === 'install_git_skills') {
    if (mock) return json({ error: 'Skill install is unavailable in mock mode' }, { status: 409 });
    const url = typeof body.url === 'string' ? body.url : '';
    const paths = Array.isArray(body.paths) ? body.paths.filter((path): path is string => typeof path === 'string') : [];
    if (paths.length === 0) return json({ error: 'Select at least one skill to install' }, { status: 400 });

    if (body.mode === 'registry') {
      const installed: string[] = [];
      const skipped: Array<{ name: string; reason: string }> = [];
      for (const path of paths) {
        const name = path.split('/').pop() ?? '';
        try {
          // The CLI takes `owner/repo`; any accepted URL form maps to it.
          await installCatalogSkill(toSkillRepoRef(url)?.slug ?? url.trim(), name);
          installed.push(name);
        } catch (error) {
          skipped.push({ name, reason: message(error) });
        }
      }
      await reloadLiveSessions();
      return json({ repo: url, mode: 'registry', installed, skipped, skills: await deps.listSkills(scope) });
    }

    // USER by default: the catalog pane names no workspace, and a managed copy
    // there is the skill the user owns globally. A `project` request needs a
    // root the caller actually named.
    const location = body.location === 'project' ? 'project' : 'user';
    if (location === 'project' && !deps.hasWorkspace) {
      return json({ error: 'Select a workspace to install a project skill' }, { status: 400 });
    }
    const outcome = await installSkillCopies(url, paths, {
      scope: location,
      projectDir: location === 'project' ? scope.workspace : null,
      overwrite: body.overwrite === true,
    });
    if (outcome.installed.length > 0) await reloadLiveSessions();
    return json({ repo: url, mode: 'managed_copy', ...outcome, skills: await deps.listSkills(scope) });
  }

  return null;
}
