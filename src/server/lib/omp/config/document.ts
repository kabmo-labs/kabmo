/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Read-modify-write of an omp YAML config file: an exclusive Kabmo lock, a
 * comment-preserving document model, an external-change retry, and an atomic
 * write that keeps the file's mode and symlink.
 *
 * Why the `yaml` document model rather than `Bun.YAML` (plain objects):
 *
 * - **Comments survive.** `~/.omp/agent/models.yml` is a hand-authored file —
 *   its providers carry notes and per-model annotations. `Bun.YAML.parse` +
 *   `stringify` discards every comment; a single model fetch would delete them.
 * - **Byte-stable round-trips.** Serializing the live `models.yml` through the
 *   document model reproduces the file exactly (23210 bytes in, 23210 out).
 *   `Bun.YAML.stringify(doc, null, 2)` rewrites it in a different style — and,
 *   worse, emits `key: ` headers with a trailing space, which is not omp's own
 *   canonical form (`stringifyYamlConfig` strips that space).
 *
 * `Bun.YAML` remains the *parser* for read-only probes, where comments and
 * formatting are irrelevant.
 *
 * Concurrency: omp serializes its own config writes with an OS-level `flock(2)`
 * on `${path}.lock`. That lock is not reachable from Bun (no `flock` binding,
 * and the lock file omp creates must not be deleted out from under it), so the
 * Kabmo takes its OWN lock file and closes the remaining window with the
 * external-change check below: if the file moved between the read and the
 * write, the edit is replayed against the fresh content instead of clobbering
 * whatever omp just wrote.
 */

import { parseDocument, isMap, isScalar, isSeq, type Document, type YAMLSeq } from 'yaml';
import { withConfigLock } from '@/server/lib/fs/config-lock';
import { writeFileAtomic } from '@/server/lib/fs/atomic-write';

/** A config file that is not a YAML mapping, or not valid YAML at all. */
export class OmpConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OmpConfigError';
  }
}

export interface DocumentEdit<T> {
  result: T;
  /** `false` when the edit turned out to be a no-op — the file is left as it is. */
  changed: boolean;
}

/** The sequence node at `path`, when it is a sequence — `null` otherwise. */
export function seqAt(doc: Document, path: (string | number)[]): YAMLSeq | null {
  const node = doc.getIn(path);
  return isSeq(node) ? node : null;
}

/**
 * The plain JavaScript value of a YAML node — never a node.
 *
 * `node.get(key, true)` is not enough: the `keepScalar` flag only unwraps
 * scalars, so a map or sequence still comes back as a node, where
 * `Array.isArray` is `false` and a naive membership check silently sees an
 * empty collection.
 */
export function plainOf<T = unknown>(doc: Document, node: unknown): T | undefined {
  if (node === undefined || node === null) return undefined;
  if (isScalar(node)) return node.value as T;
  if (isMap(node) || isSeq(node)) return node.toJS(doc) as T;
  return undefined;
}

/** The plain JavaScript value at `path` — never a node. */
export function valueAt<T = unknown>(doc: Document, path: (string | number)[]): T | undefined {
  return plainOf<T>(doc, doc.getIn(path));
}

const EXTERNAL_CHANGE_RETRIES = 5;

/** Identity of a file version: absent files hash to `missing`. */
async function fileGeneration(path: string): Promise<string> {
  try {
    const stat = await Bun.file(path).stat();
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return 'missing';
  }
}

/**
 * Edit an omp YAML config in place. `edit` receives a live document, mutates it,
 * and reports whether anything actually changed; the write only happens when it
 * did. Replayed when another process writes the file mid-edit, so the edit is
 * never applied on top of stale content.
 *
 * A file created here is `0600`: both omp configs carry plaintext credentials
 * (`models.yml` holds provider `apiKey`s), and omp opens its own config temp
 * with `wx, 0o600` for the same reason. An existing file keeps its own mode.
 */
export async function withOmpYamlDocument<T>(
  path: string,
  edit: (doc: Document) => DocumentEdit<T> | Promise<DocumentEdit<T>>,
): Promise<T> {
  // Not `${path}.lock`: that file belongs to omp's own flock lease.
  return withConfigLock(`${path}.kabmo.lock`, async () => {
    for (let attempt = 0; ; attempt++) {
      const before = await fileGeneration(path);
      const source = (await Bun.file(path).exists()) ? await Bun.file(path).text() : '';
      const doc = parseDocument(source);
      if (doc.errors.length > 0) {
        throw new OmpConfigError(`${path} is not valid YAML: ${doc.errors[0].message.split('\n')[0]}`);
      }
      if (doc.contents !== null && !isMap(doc.contents)) {
        throw new OmpConfigError(`${path} must contain a YAML mapping`);
      }

      const { result, changed } = await edit(doc);
      if (!changed) return result;
      if (attempt < EXTERNAL_CHANGE_RETRIES && (await fileGeneration(path)) !== before) {
        // Another process rewrote the file while this edit was being computed.
        // Replay against its content rather than overwrite the newer change.
        continue;
      }
      await writeFileAtomic(path, doc.toString({ indent: 2 }), { createMode: 0o600 });
      return result;
    }
  });
}
