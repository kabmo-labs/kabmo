/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Reading and rewriting a registry FILE, in the format that file is written in.
 *
 * Split from the writer so the write path reads as decisions (which format,
 * which protocol, what must not be overwritten) instead of parse/serialise
 * plumbing. The two concerns do not need one file to agree: `serialise` and
 * `parseDocument` are dispatch tables over `ProviderRegistryKind`, and the
 * writer is their only caller.
 *
 * A file that will not parse is REFUSED rather than replaced: these documents
 * also hold plugins, agents, MCP servers and approval policy, and rewriting one
 * from a value Kabmo failed to read is how a working agent loses its config.
 */

import YAML from 'yaml';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';

import type { ProviderRegistryKind } from '@/shared/lib/harness/provider-facts';
import { asRecord } from '@/server/lib/harness/provider-entry';
import { ProviderWriteError } from '@/server/lib/harness/provider-write-error';

/** Serialise a document back in its own format. */
export function serialise(kind: ProviderRegistryKind, doc: Record<string, unknown>): string {
  switch (kind) {
    case 'yaml-providers': return YAML.stringify(doc);
    case 'toml-model-providers':
    case 'toml-providers': return `${stringifyToml(doc)}\n`;
    // The desktop's own writer emits two-space JSON with NO trailing newline;
    // a non-canonical file is read fine but rewritten on the app's next save.
    case 'zcode-provider-rules': return JSON.stringify(doc, null, 2);
    default: return `${JSON.stringify(doc, null, 2)}\n`;
  }
}

/** Parse a document in its own format, or throw with the reason. */
export function parseDocument(kind: ProviderRegistryKind, text: string, path: string): Record<string, unknown> {
  try {
    const parsed = kind === 'yaml-providers'
      ? YAML.parse(text)
      : kind === 'toml-model-providers' || kind === 'toml-providers'
        ? parseToml(text)
        : JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ProviderWriteError(`${path} is not a document, so it was left untouched`);
    }
    return parsed as Record<string, unknown>;
  } catch (cause) {
    if (cause instanceof ProviderWriteError) throw cause;
    throw new ProviderWriteError(`${path} could not be parsed, so it was left untouched: ${String(cause)}`);
  }
}

/** The map a provider node lives in, created when absent and refused when wrong. */
export function providerMap(doc: Record<string, unknown>, pointer: string, path: string): Record<string, unknown> {
  const head = pointer.split('.')[0];
  if (doc[head] !== undefined && (typeof doc[head] !== 'object' || Array.isArray(doc[head]))) {
    throw new ProviderWriteError(`${path}: "${head}" is not an object, so it was left untouched`);
  }
  const map = asRecord(doc[head]);
  doc[head] = map;
  return map;
}
