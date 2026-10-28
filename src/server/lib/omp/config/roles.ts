/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Read/write of the native OMP role selectors (`modelRoles`) in
 * ~/.omp/agent/config.yml — the access-control mapping of role → model
 * selector used by omp (e.g. the advisor role). Faithful port of
 * omp-web/lib/omp/model-roles.ts.
 */

import { getOmpConfigPath } from '@/server/lib/omp/config/yaml';
import { withOmpYamlDocument } from '@/server/lib/omp/config/document';
import { isRecord } from '@/shared/lib/util/guards';

export type ModelRoles = Record<string, string>;

/** Reads the native OMP role selectors from config.yml without touching other settings. */
export async function readModelRoles(): Promise<{ path: string; roles: ModelRoles }> {
  const path = getOmpConfigPath();
  if (!(await Bun.file(path).exists())) return { path, roles: {} };
  const data = Bun.YAML.parse(await Bun.file(path).text());
  if (!isRecord(data) || !isRecord(data.modelRoles)) return { path, roles: {} };
  return {
    path,
    roles: Object.fromEntries(Object.entries(data.modelRoles).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
  };
}

/** Updates only modelRoles, preserving the user's remaining native OMP config. */
export async function writeModelRoles(roles: ModelRoles): Promise<void> {
  const path = getOmpConfigPath();
  await withOmpYamlDocument(path, (doc) => {
    doc.set('modelRoles', roles);
    return { result: undefined, changed: true };
  });
}
