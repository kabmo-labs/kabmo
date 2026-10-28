/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Faithful port of omp's path-scoped array resolution
 * (`resolvePathScopedStringArray` in omp's `config/settings.ts`).
 *
 * `disabledProviders`, `enabledProviders`, and `enabledModels` are the three
 * settings omp treats as path-scoped: an entry may be a bare string, or an
 * object carrying `path`/`paths`/`pathPrefix`/`pathPrefixes` plus the values to
 * apply only under those prefixes. The Kabmo must not flatten that shape —
 * dropping the objects loses the user's per-project policy — and must resolve
 * it the same way omp does, or the provider settings would disagree with the
 * model list omp serves.
 */

import { homedir } from 'os';
import path from 'path';
import { isRecord } from '@/shared/lib/util/guards';

/** Prefix keys omp accepts on a path-scoped entry, in its own order. */
export const PREFIX_KEYS = ['path', 'paths', 'pathPrefix', 'pathPrefixes'] as const;
/** Value keys omp accepts on a path-scoped entry, in its own order. */
export const VALUE_KEYS = ['values', 'items', 'providers'] as const;

function stringsFromUnknown(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/** `~/x` → `<home>/x`, matching omp's `expandTilde`. */
function expandTilde(value: string): string {
  if (value === '~') return homedir();
  return value.startsWith('~/') ? path.join(homedir(), value.slice(2)) : value;
}

/** True when `cwd` sits at or under `prefix` (omp's `pathMatchesPrefix`). */
function pathMatchesPrefix(cwd: string, prefix: string): boolean {
  const relative = path.relative(path.resolve(expandTilde(prefix)), path.resolve(cwd));
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Flatten a path-scoped setting for one cwd. Bare strings always apply;
 * object entries apply only when one of their prefixes contains `cwd`.
 */
export function resolvePathScopedSlugs(value: unknown, cwd: string): string[] {
  if (!Array.isArray(value)) return [];
  const resolved: string[] = [];
  for (const entry of value) {
    if (typeof entry === 'string') {
      resolved.push(entry);
      continue;
    }
    if (!isRecord(entry)) continue;
    const prefixes = PREFIX_KEYS.flatMap((key) => stringsFromUnknown(entry[key]));
    if (prefixes.length === 0 || !prefixes.some((prefix) => pathMatchesPrefix(cwd, prefix))) continue;
    resolved.push(...VALUE_KEYS.flatMap((key) => stringsFromUnknown(entry[key])));
  }
  return resolved;
}

/** True when the entry is a path-scoped object rather than a bare slug. */
export function isPathScopedEntry(entry: unknown): boolean {
  return isRecord(entry) && PREFIX_KEYS.some((key) => entry[key] !== undefined);
}

/** The slugs a path-scoped entry contributes, ignoring its prefixes. */
export function pathScopedEntryValues(entry: unknown): string[] {
  if (!isRecord(entry)) return [];
  return VALUE_KEYS.flatMap((key) => stringsFromUnknown(entry[key]));
}
