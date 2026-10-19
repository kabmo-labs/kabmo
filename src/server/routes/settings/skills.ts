import { json } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import { getDb } from '@/server/db.server';
import { DEFAULT_CATALOG_SKILLS, DEFAULT_CATALOG_SOURCES, DEFAULT_SKILLS } from '@/client/data/settings/skill';
import { isMockMode } from '@/server/mock.server';
import type { SkillItem } from '@/shared/types';
import { readSettingsJson, writeSettingsJson } from '@/server/lib/db/settings-store';
import {
  deleteSkillDir,
  discoverSkills,
  readSkillFile,
  setSkillModelInvocation,
  writeSkillFile,
  type DiscoveredSkill,
} from '@/server/lib/omp/config/skills';
import {
  installCatalogSkill,
  searchSkillCatalog,
  toCatalogSkills,
  uninstallCatalogSkill,
} from '@/server/lib/omp/config/skills-catalog';
import { resolveDiscoveryScope, type DiscoveryScope } from '@/server/lib/omp/config/scope';
import { reloadLiveSessions } from '@/server/lib/omp/session/reload.server';

const SOURCES_KEY = 'omp_catalog_sources';

/** Human label for an omp discovery source. */
const SOURCE_LABELS: Record<string, string> = {
  'native:user': 'User / omp agent',
  'native:project': 'Project / .omp/skills',
  'agents:user': 'User / .agents',
  'agents:project': 'Project / .agents',
  'claude:user': 'User / .claude',
  'claude:project': 'Project / .claude',
  'codex:user': 'User / .codex',
  'codex:project': 'Project / .codex',
  'github:project': 'Project / .github/skills',
  'opencode:user': 'User / opencode',
  'opencode:project': 'Project / .opencode',
};

/**
 * Convert a discovered skill into Kabmo's SkillItem. A Kabmo-managed
 * skill carries its SKILL.md body so the pane can edit it; a read-only one
 * carries its file path, because the pane must not offer a save that would
 * rewrite another tool's file.
 */
async function toSkillItem(skill: DiscoveredSkill): Promise<SkillItem> {
  const locationLabel = SOURCE_LABELS[skill.source] ?? skill.source;
  let instructions = skill.filePath;
  if (skill.managed) {
    const file = await readSkillFile(skill.filePath);
    if (file) instructions = file.body;
  }
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    location: skill.sourceRoot,
    locationLabel,
    instructions,
    project: 'omp',
    filePath: skill.filePath,
    source: skill.source,
    managed: skill.managed,
    hidden: skill.hidden,
  };
}

/** Every skill an omp session in this scope loads, newest state included. */
async function listSkills(scope: DiscoveryScope): Promise<SkillItem[]> {
  const discovered = await discoverSkills(scope.cwd, scope.workspace);
  return Promise.all(discovered.map((skill) => toSkillItem(skill)));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function loader({ request }: LoaderFunctionArgs) {
  const mock = isMockMode();
  try {
    if (mock) {
      const db = await getDb();
      const storedSources = await readSettingsJson<typeof DEFAULT_CATALOG_SOURCES>(db, SOURCES_KEY, DEFAULT_CATALOG_SOURCES);
      return json({
        skills: DEFAULT_SKILLS,
        catalogSources: Array.isArray(storedSources) && storedSources.length > 0 ? storedSources : DEFAULT_CATALOG_SOURCES,
        catalogSkills: DEFAULT_CATALOG_SKILLS,
        root: null,
        isMock: true,
      });
    }

    const db = await getDb();
    const url = new URL(request.url);
    const scope = await resolveDiscoveryScope(url.searchParams.get('root'), url.searchParams.get('scope'));

    const storedSources = await readSettingsJson<typeof DEFAULT_CATALOG_SOURCES>(db, SOURCES_KEY, DEFAULT_CATALOG_SOURCES);
    const catalogSources = Array.isArray(storedSources) && storedSources.length > 0 ? storedSources : DEFAULT_CATALOG_SOURCES;

    const [skills, popular, curated] = await Promise.all([
      listSkills(scope),
      searchSkillCatalog('popular', 18),
      searchSkillCatalog('code review', 8),
    ]);

    const seen = new Set<string>();
    const catalogSkills = toCatalogSkills([...popular, ...curated], catalogSources[0]?.id ?? 'skills-sh')
      .filter((item) => (seen.has(item.repoTag) ? false : (seen.add(item.repoTag), true)));

    return json({ skills, catalogSources, catalogSkills, root: scope.workspace, isMock: false });
  } catch (error) {
    return json({
      error: errorMessage(error),
      skills: [],
      catalogSources: DEFAULT_CATALOG_SOURCES,
      catalogSkills: DEFAULT_CATALOG_SKILLS,
      root: null,
      isMock: mock,
    }, { status: 500 });
  }
}

export async function action({ request, params }: ActionFunctionArgs) {
  const mock = isMockMode();
  try {
    const db = await getDb();
    const url = new URL(request.url);

    if (request.method === 'DELETE') {
      const scope = await resolveDiscoveryScope(url.searchParams.get('root'), url.searchParams.get('scope'));
      const id = url.searchParams.get('id');
      if (!id) return json({ error: 'id is required' }, { status: 400 });
      if (mock) return json({ success: true, skills: DEFAULT_SKILLS });

      const removed = await deleteSkillDir(id, scope.workspace);
      if (!removed) return json({ error: 'Skill not found' }, { status: 404 });
      await reloadLiveSessions();
      return json({ success: true, skills: await listSkills(scope) });
    }

    if (request.method !== 'POST' && request.method !== 'PUT') {
      return methodNotAllowed({ request, params });
    }

    const body = await request.json();
    // The root may ride on the query (a plain GET-shaped read) or in the body
    // (a POST that carries the draft), so a write is scoped either way.
    const scope = await resolveDiscoveryScope(
      url.searchParams.get('root') ?? (typeof body.root === 'string' ? body.root : null),
      url.searchParams.get('scope') ?? (typeof body.scope === 'string' ? body.scope : null),
    );

    // Toggle model invocation: the skill stays runnable, it just drops out of
    // the model's skill listing.
    if (body.type === 'toggle_model_invocation') {
      if (mock) return json({ success: false });
      const target = (await discoverSkills(scope.cwd, scope.workspace)).find((skill) => skill.id === body.skillId);
      if (!target) return json({ error: 'Skill not found' }, { status: 404 });
      const changed = await setSkillModelInvocation(target.filePath, body.disable === true);
      if (changed) await reloadLiveSessions();
      return json({ success: changed, skills: await listSkills(scope) });
    }

    if (body.type === 'reload') {
      if (mock) return json({ success: true, reloaded: [] });
      const reloaded = await reloadLiveSessions();
      return json({ success: true, reloaded });
    }

    if (body.type === 'add_source') {
      const sources = await readSettingsJson<typeof DEFAULT_CATALOG_SOURCES>(db, SOURCES_KEY, DEFAULT_CATALOG_SOURCES);
      const updated = [...sources, body.source];
      await writeSettingsJson(db, SOURCES_KEY, updated);
      return json({ success: true, catalogSources: updated });
    }

    // Catalog install/uninstall goes through the real skills CLI, which is what
    // actually puts the skill where omp reads it.
    if (body.type === 'install_toggle') {
      const { skill, install } = body;
      if (mock) return json({ success: true, skills: DEFAULT_SKILLS });

      if (install) {
        if (typeof skill.repoTag === 'string' && /^[\w.\-]+\/[\w.\-@:]+$/.test(skill.repoTag)) {
          await installCatalogSkill(skill.repoTag, typeof skill.name === 'string' ? skill.name : null);
        }
      } else if (typeof skill.name === 'string' && skill.name.trim()) {
        await uninstallCatalogSkill(skill.name.trim());
      }
      await reloadLiveSessions();
      return json({ success: true, skills: await listSkills(scope) });
    }

    // Create or update a Kabmo-managed SKILL.md.
    if (body.skill) {
      if (mock) return json({ success: true, skills: DEFAULT_SKILLS });

      const draft = body.skill as Partial<SkillItem>;
      const target = draft.location === 'project' ? 'project' : 'user';
      const existing = typeof draft.id === 'string'
        ? (await discoverSkills(scope.cwd, scope.workspace)).find((skill) => skill.id === draft.id)
        : undefined;
      if (existing && !existing.managed) {
        return json({ error: `"${existing.name}" is managed by ${existing.source} and cannot be edited here` }, { status: 403 });
      }

      await writeSkillFile({
        scope: target,
        projectDir: scope.workspace,
        previousDir: existing?.baseDir ?? null,
        name: draft.name ?? '',
        description: draft.description ?? '',
        hidden: draft.hidden === true,
        body: typeof draft.instructions === 'string' ? draft.instructions : '',
      });
      await reloadLiveSessions();
      return json({ success: true, skills: await listSkills(scope) });
    }

    return json({ error: 'Unsupported skill action' }, { status: 400 });
  } catch (error) {
    return json({ error: errorMessage(error) }, { status: 500 });
  }
}
