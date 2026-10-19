/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Read/write of the native OMP `disabledProviders` list in
 * ~/.omp/agent/config.yml — the flag behind connect/disconnect in the provider
 * settings. Writes are atomic read-modify-writes that preserve every other key
 * in the file, its comments, and its path-scoped entries.
 *
 * `disabledProviders` is a PATH-SCOPED setting in omp: alongside bare slugs the
 * list may carry `{ path: ~/work, providers: [deepseek] }` entries that disable
 * a provider only under that prefix. A writer that filters the list down to
 * strings and writes it back silently deletes the user's per-project policy, so
 * every mutation here edits the entry in place and leaves the other entries
 * untouched.
 */

import { homedir } from 'os';
import { isMap, isScalar, type Document } from 'yaml';
import { getOmpConfigPath } from '@/server/lib/omp/config/yaml';
import { seqAt, valueAt, withOmpYamlDocument } from '@/server/lib/omp/config/document';
import { VALUE_KEYS, isPathScopedEntry, pathScopedEntryValues, resolvePathScopedSlugs } from '@/server/lib/omp/config/path-scoped';

/** The string members of a value key, without assuming it is an array. */
function stringsIn(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/** Every slug the raw list mentions, path-scoped entries included. */
function listSlugs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => (
    typeof entry === 'string' ? [entry] : pathScopedEntryValues(entry)
  ));
}

/**
 * Re-enable a disabled provider by removing it from config.yml
 * disabledProviders. Returns false when it was not disabled in the first place.
 *
 * A path-scoped entry is never deleted — the provider is only removed from its
 * value list, because the entry's prefix policy applies to the other providers
 * it names too.
 */
export async function enableNativeProvider(slug: string): Promise<boolean> {
  const path = getOmpConfigPath();
  return withOmpYamlDocument(path, (doc: Document) => {
    const seq = seqAt(doc, ['disabledProviders']);
    if (!seq) return { result: false, changed: false };

    let changed = false;
    // Walk backwards so deleting an item cannot shift the indices still to visit.
    for (let index = seq.items.length - 1; index >= 0; index--) {
      const item = seq.items[index];
      if (isScalar(item) && item.value === slug) {
        seq.delete(index);
        changed = true;
        continue;
      }
      if (!isMap(item) || !isPathScopedEntry(item.toJS(doc))) continue;
      const record = item.toJS(doc) as Record<string, unknown>;
      const values = pathScopedEntryValues(record);
      if (!values.includes(slug)) continue;
      changed = true;
      const remaining = values.filter((value) => value !== slug);
      if (remaining.length === 0) {
        seq.delete(index);
        continue;
      }
      // Update the key that actually held the slug, so a hand-authored
      // `providers:` list stays `providers:` rather than turning into `values:`.
      const holder = VALUE_KEYS.find((key) => stringsIn(record[key]).includes(slug));
      item.set(holder ?? 'values', remaining);
    }
    return { result: changed, changed };
  });
}

/**
 * Disable a provider by appending it to config.yml disabledProviders — the
 * mirror of enableNativeProvider. Written to the agent's own registry so a
 * later provider merge cannot resurrect it as connected. Creates config.yml
 * when absent; returns false when the provider was already disabled.
 */
export async function disableNativeProvider(slug: string): Promise<boolean> {
  const path = getOmpConfigPath();
  return withOmpYamlDocument(path, (doc: Document) => {
    const seq = seqAt(doc, ['disabledProviders']);
    if (listSlugs(valueAt(doc, ['disabledProviders'])).includes(slug)) {
      return { result: false, changed: false };
    }
    if (seq) seq.add(slug);
    else doc.set('disabledProviders', [slug]);
    return { result: true, changed: true };
  });
}

/** Reads the raw list including path-scoped entries (no cwd filtering). */
export async function readDisabledProviderEntries(): Promise<unknown[]> {
  const path = getOmpConfigPath();
  if (!(await Bun.file(path).exists())) return [];
  const parsed = Bun.YAML.parse(await Bun.file(path).text()) as { disabledProviders?: unknown } | null;
  return Array.isArray(parsed?.disabledProviders) ? parsed.disabledProviders : [];
}

/**
 * Slugs disabled for `cwd`, with path-scoped entries resolved the way omp
 * resolves them. Defaults to the shared utility RPC process's cwd (`homedir()`),
 * which is the cwd omp itself uses when Kabmo asks it for the model list —
 * so Kabmo's own filter agrees with the list omp just served.
 */
export async function readDisabledProviders(cwd: string = homedir()): Promise<Set<string>> {
  return new Set(resolvePathScopedSlugs(await readDisabledProviderEntries(), cwd));
}
