/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Skillshare catalog bridge — the registry omp itself installs from.
 *
 * Every call is an `omp skill …` invocation, not a second HTTP client and not
 * `bunx skills`: omp owns the registry URL (`skills.registryUrl`), the manifest
 * (`~/.omp/agent/skills.json`) and the store (`~/.omp/skillshare`), and a
 * catalog that wrote through another tool would list skills omp never loads.
 * Measured on 18.20.0: `omp skill search <q> --json` answers
 * `{ total, page, perPage, hits: [{ scope, name, version, description,
 * weeklyDownloads, publisher: { username } }] }`, and `omp skill install -g
 * @scope/name` records the package in the user manifest.
 *
 * Search failures degrade to an empty list so the catalog tab still renders;
 * install/uninstall failures are thrown, because a refused write must reach the
 * user instead of looking like a no-op.
 */

import { isMockMode } from '@/server/mock.server';
import type { CatalogSkillItem } from '@/shared/types';
import { childEnv } from '@/server/lib/fs/child-env';
import { resolveOmpBin } from '@/server/lib/omp/core/cli';

const SEARCH_TIMEOUT_MS = 30_000;
const INSTALL_TIMEOUT_MS = 180_000;

/** `@scope/name`, optionally pinned to a version/range/tag. */
const PACKAGE_SPEC = /^@[a-z0-9][a-z0-9_]{2,31}\/[a-z0-9]+(?:-[a-z0-9]+)*(?:@[^\s]+)?$/;

export interface CatalogSearchResult {
  /** `@scope/name` — the spec `omp skill install` takes. */
  package: string;
  name: string;
  description: string;
  /** Publisher username, or the scope when the registry omits one. */
  source: string;
  /** Weekly downloads, the registry's own popularity number. */
  installs: number;
  version?: string;
}

interface CliSearchHit {
  scope?: unknown;
  name?: unknown;
  version?: unknown;
  description?: unknown;
  weeklyDownloads?: unknown;
  publisher?: { username?: unknown };
}

/** Run one `omp skill …` command; a non-zero exit is an Error with omp's line. */
async function runOmpSkill(args: string[], timeout: number): Promise<string> {
  const bin = resolveOmpBin();
  if (!bin) throw new Error('omp binary not found');
  const proc = Bun.spawn({
    env: childEnv(),
    cmd: [bin, 'skill', ...args],
    stdout: 'pipe',
    stderr: 'pipe',
    timeout,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    // omp prefixes its failures with `error ` and no ANSI colour when the
    // stream is not a TTY; the sentence itself is what the user needs.
    const line = stderr.trim().split('\n').filter(Boolean).pop() ?? '';
    const message = line.replace(/^[^\w@/]*/, '').replace(/^error:?\s+/i, '').trim();
    throw new Error(message || `omp skill ${args[0]} exited with code ${exitCode}`);
  }
  return stdout;
}

/** Search the Skillshare registry; returns [] on any failure. */
export async function searchSkillCatalog(
  query: string,
  limit = 24,
  sort: 'relevance' | 'downloads' | 'recent' = 'relevance',
): Promise<CatalogSearchResult[]> {
  if (isMockMode()) return [];
  const trimmed = query.trim();
  if (!trimmed) return [];
  try {
    const stdout = await runOmpSkill(['search', trimmed, '--sort', sort, '--json'], SEARCH_TIMEOUT_MS);
    const data = JSON.parse(stdout) as { hits?: CliSearchHit[] };
    const results: CatalogSearchResult[] = [];
    for (const hit of data.hits ?? []) {
      const scope = typeof hit.scope === 'string' ? hit.scope : '';
      const name = typeof hit.name === 'string' ? hit.name : '';
      if (!scope || !name) continue;
      results.push({
        package: `@${scope}/${name}`,
        name,
        description: typeof hit.description === 'string' ? hit.description : '',
        source: typeof hit.publisher?.username === 'string' ? hit.publisher.username : scope,
        installs: typeof hit.weeklyDownloads === 'number' ? hit.weeklyDownloads : 0,
        ...(typeof hit.version === 'string' ? { version: hit.version } : {}),
      });
      if (results.length >= limit) break;
    }
    return results;
  } catch {
    return [];
  }
}

/** Map registry hits into the CatalogSkillItem contract of the UI.
 * `instructions` carries the package spec so a later install POST can resolve
 * it back to a Skillshare package without extra component fields. */
export function toCatalogSkills(results: CatalogSearchResult[], sourceId: string): CatalogSkillItem[] {
  return results.map((result) => ({
    id: `catalog-${result.package}`,
    sourceId,
    name: result.name,
    description: result.description,
    repoTag: result.package,
    instructions: result.package,
    ...(result.installs > 0 ? { installs: result.installs } : {}),
  }));
}

/**
 * Install one registry package into the user-global manifest.
 *
 * `-g` is what makes the install visible to every omp session: the project
 * manifest is anchored on the directory omp runs in, and the catalog pane names
 * no workspace. `-y` accepts a package that ships scripts, which is the same
 * consent the CLI's own prompt asks for.
 */
export async function installCatalogSkill(pkg: string): Promise<{ output: string }> {
  if (!PACKAGE_SPEC.test(pkg)) throw new Error('Invalid skill package');
  if (isMockMode()) throw new Error('Skill install is unavailable in mock mode');
  const output = await runOmpSkill(['install', pkg, '-g', '-y'], INSTALL_TIMEOUT_MS);
  return { output: output.slice(-4000) };
}

/**
 * Uninstall a registry package by its `@scope/name` spec. `omp skill uninstall`
 * is the counterpart of the install above and clears the manifest entry and the
 * store directory, which is what a catalog "Uninstall" has to undo.
 */
export async function uninstallCatalogSkill(pkg: string): Promise<{ output: string }> {
  if (!PACKAGE_SPEC.test(pkg)) throw new Error('Invalid skill package');
  if (isMockMode()) throw new Error('Skill uninstall is unavailable in mock mode');
  const output = await runOmpSkill(['uninstall', pkg, '-g'], INSTALL_TIMEOUT_MS);
  return { output: output.slice(-4000) };
}

/** Update one installed registry package within its recorded range. */
export async function checkCatalogSkillUpdate(pkg: string): Promise<{ output: string }> {
  if (!PACKAGE_SPEC.test(pkg)) throw new Error('Invalid skill package');
  const output = await runOmpSkill(['update', pkg, '-g'], INSTALL_TIMEOUT_MS);
  return { output: output.slice(-4000) };
}
