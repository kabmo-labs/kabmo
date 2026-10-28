/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Shared YAML/config helpers for the native OMP config files: the canonical
 * `~/.omp/agent/config.yml` path, a top-level-mapping assertion, and the minimal
 * frontmatter parser used by agent and skill markdown files.
 */

import { join } from 'path';
import { getAgentDir } from '@/server/lib/omp/core/paths';
import { isRecord } from '@/shared/lib/util/guards';

/** Native OMP user config path: ~/.omp/agent/config.yml. */
export function getOmpConfigPath(): string {
  return join(getAgentDir(), 'config.yml');
}

/** Parses a YAML file that must be a top-level mapping; throws otherwise. */
export function asMapping(parsed: unknown, path: string): Record<string, unknown> {
  if (!isRecord(parsed)) throw new Error(`${path} must contain a YAML mapping`);
  return parsed;
}

/**
 * Minimal YAML frontmatter (---\nkey: value\n---) parser for agent/skill files.
 * Only top-level keys belong to the map; indented lines are nested block
 * content (e.g. an `output:` JSON schema) and must not override top-level keys.
 */
export function parseFrontmatter(text: string): { data: Record<string, string>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { data: {}, body: text };
  const data: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (/^\s/.test(line)) continue;
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) data[key] = value;
  }
  return { data, body: text.slice(match[0].length) };
}
