/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Native OMP agent discovery and writing.
 *
 * An agent definition is a markdown file with frontmatter, and omp reads a
 * FIXED set of keys out of it — measured against the installed
 * `@oh-my-pi/pi-coding-agent` 18.16.0 (`discovery/helpers.ts` `parseAgentFields`):
 *
 *   name, description, tools, spawns, model, output, thinkingLevel,
 *   blocking, structured, prewalk, advisor, autoloadSkills, readSummarize
 *
 * Anything else in the file is ignored by omp, so a panel that offered `mode`,
 * `temperature` or `top_p` was offering three controls that changed a file omp
 * never reads — the agent kept behaving exactly as before. Worse, a writer that
 * emitted ONLY its own keys silently DELETED `tools`, `spawns` and the nested
 * `output:` schema from a shipped agent the moment its prompt was edited.
 *
 * Two rules follow, and both are load-bearing:
 *
 *   - discovery parses the keys omp honours, including `model` as a block list
 *     (`model:\n  - "@smol"`, which the scalar-only parser read as empty);
 *   - writing edits the frontmatter IN PLACE: a key the file already has is
 *     replaced where it stands, a key it lacks is appended, and every line the
 *     panel does not own — including a multi-line `output:` block — survives
 *     byte for byte.
 */

import fs from 'fs';
import { basename, join } from 'path';
import { getAgentDir, pathExists } from '@/server/lib/omp/core/paths';
import { writeFileAtomic } from '@/server/lib/fs/atomic-write';

export interface DiscoveredAgent {
  id: string;
  name: string;
  description: string;
  /** Tool allowlist; absent means omp's default set. */
  tools?: string[];
  /** `"*"` or a name list: which agents this one may spawn. */
  spawns?: string;
  /** `provider/model`, or a role selector such as `@smol`. */
  model?: string;
  /** `off` … `max`, or `auto`; absent means the session's level. */
  thinkingLevel?: string;
  systemPrompt: string;
  sourceRoot: 'user' | 'project';
  filePath: string;
}

/** A key the panel owns, so it may be rewritten. Everything else is preserved. */
export interface AgentFileInput {
  fileName: string;
  name: string;
  description: string;
  /** Cleared when empty — an absent key is how omp spells "use the default". */
  model?: string;
  thinkingLevel?: string;
  /** `undefined` leaves the file's own tools line untouched. */
  tools?: string[];
  spawns?: string;
  systemPrompt: string;
}

/** Frontmatter scalar keys the panel edits. */
const OWNED_KEYS = ['name', 'description', 'model', 'thinkingLevel', 'tools', 'spawns'] as const;
type OwnedKey = (typeof OWNED_KEYS)[number];

/** Unquote a frontmatter scalar the way omp writes it. */
function unquote(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Quote a value so a `:` or `#` in it cannot change the document's meaning. */
function quote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

interface FrontmatterBlock {
  /** Lines between the fences (`[]` for a file with an empty block). */
  lines: string[];
  /** Everything after the closing fence, fence included in `body`'s own prefix. */
  body: string;
  /** True when the file has no frontmatter fences at all. */
  missing: boolean;
}

/** Split a definition file into its frontmatter lines and its body. */
function splitDefinition(text: string): FrontmatterBlock {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/.exec(text);
  if (!match) return { lines: [], body: text, missing: true };
  return {
    lines: match[1].split(/\r?\n/),
    body: text.slice(match[0].length),
    missing: false,
  };
}

/**
 * Read the frontmatter of a definition into the keys omp actually parses.
 *
 * `parseFrontmatter` in `yaml.ts` is scalar-only and cannot see a block list —
 * and `model` is written as one (`model:\n  - "@smol"`), so probing it with that
 * parser reported every shipped agent as having no model.
 */
export function parseAgentDefinition(text: string): {
  name?: string;
  description?: string;
  model?: string;
  thinkingLevel?: string;
  tools?: string[];
  spawns?: string;
  body: string;
} {
  const { lines, body } = splitDefinition(text);
  const scalars = new Map<string, string>();
  const lists = new Map<string, string[]>();
  let current: string | null = null;

  for (const line of lines) {
    const listItem = /^\s*-\s+(.*)$/.exec(line);
    if (listItem && current) {
      const values = lists.get(current) ?? [];
      values.push(unquote(listItem[1]));
      lists.set(current, values);
      continue;
    }
    const entry = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!entry) continue;
    current = entry[1];
    const value = unquote(entry[2]);
    if (value) scalars.set(current, value);
    else if (!lists.has(current)) lists.set(current, []);
  }

  const toolsRaw = scalars.get('tools') ?? lists.get('tools')?.join(',');
  const tools = toolsRaw
    ? toolsRaw.split(',').map((item) => item.trim()).filter(Boolean)
    : undefined;

  return {
    ...(scalars.has('name') ? { name: scalars.get('name') } : {}),
    ...(scalars.has('description') ? { description: scalars.get('description') } : {}),
    // omp accepts either spelling; `thinkingLevel` is the one it writes.
    ...(scalars.has('thinkingLevel') ? { thinkingLevel: scalars.get('thinkingLevel') }
      : scalars.has('thinking') ? { thinkingLevel: scalars.get('thinking') } : {}),
    ...(scalars.has('model') ? { model: scalars.get('model') }
      : lists.get('model')?.length ? { model: lists.get('model')![0] } : {}),
    ...(tools ? { tools } : {}),
    ...(scalars.has('spawns') ? { spawns: scalars.get('spawns') } : {}),
    body: body.trim(),
  };
}

async function parseAgentFile(filePath: string, sourceRoot: 'user' | 'project'): Promise<DiscoveredAgent | undefined> {
  try {
    const file = Bun.file(filePath);
    if ((await file.stat()).size > 512 * 1024) return undefined;
    const parsed = parseAgentDefinition(await file.text());
    const base = basename(filePath).replace(/\.md$/, '') || filePath;
    const name = parsed.name || base;
    if (!name) return undefined;
    return {
      id: `omp-${sourceRoot}-${base}`,
      name,
      description: parsed.description ?? '',
      ...(parsed.tools ? { tools: parsed.tools } : {}),
      ...(parsed.spawns ? { spawns: parsed.spawns } : {}),
      ...(parsed.model ? { model: parsed.model } : {}),
      ...(parsed.thinkingLevel ? { thinkingLevel: parsed.thinkingLevel } : {}),
      systemPrompt: parsed.body,
      sourceRoot,
      filePath,
    };
  } catch {
    return undefined;
  }
}

async function scanAgentsDir(dir: string, sourceRoot: 'user' | 'project'): Promise<DiscoveredAgent[]> {
  if (!(await pathExists(dir))) return [];
  try {
    const found: DiscoveredAgent[] = [];
    for (const entry of await fs.promises.readdir(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const agent = await parseAgentFile(join(dir, entry.name), sourceRoot);
      if (agent) found.push(agent);
    }
    return found;
  } catch {
    return [];
  }
}

/**
 * Discover native agents from both disk roots. User agents win over project
 * agents with the same file base name. Never throws.
 */
export async function discoverNativeAgents(projectDir?: string): Promise<DiscoveredAgent[]> {
  const userDir = join(getAgentDir(), 'agents');
  const byBase = new Map<string, DiscoveredAgent>();
  for (const agent of await scanAgentsDir(userDir, 'user')) {
    byBase.set(basename(agent.filePath) || agent.id, agent);
  }
  if (projectDir) {
    for (const agent of await scanAgentsDir(projectDir, 'project')) {
      const base = basename(agent.filePath) || agent.id;
      if (!byBase.has(base)) byBase.set(base, agent);
    }
  }
  return [...byBase.values()];
}

/** How many lines a top-level key occupies, continuation lines included. */
function blockLength(lines: string[], start: number): number {
  let end = start + 1;
  while (end < lines.length && /^\s+\S/.test(lines[end])) end++;
  return end - start;
}

/**
 * The YAML lines for one owned key.
 *
 *   - `string[]` — write these lines;
 *   - `null` — REMOVE the key (that is how omp spells "use the default");
 *   - `undefined` — leave whatever the file already has alone.
 *
 * `tools: undefined` is the third case on purpose: the pane does not offer a
 * tool allowlist, and re-serializing one would flatten a block list or, worse,
 * delete a restriction the shipped agent depends on.
 */
function renderKey(key: OwnedKey, input: AgentFileInput): string[] | null | undefined {
  if (key === 'tools') {
    if (input.tools === undefined) return undefined;
    return input.tools.length === 0 ? null : [`tools: ${input.tools.join(', ')}`];
  }
  const value = key === 'name' ? input.name
    : key === 'description' ? input.description
      : key === 'model' ? input.model
        : input.spawns;
  if (key === 'thinkingLevel') {
    return input.thinkingLevel ? ['thinkingLevel: ' + input.thinkingLevel] : null;
  }
  if (!value || !value.trim()) return null;
  // `spawns: *` is a YAML alias, so a bare star has to be quoted.
  return [`${key}: ${key === 'spawns' ? quote(value.trim()) : quote(value)}`];
}

/**
 * Rewrite one definition file, preserving every line the panel does not own.
 *
 * The owned key is replaced WHERE IT STANDS (rather than the frontmatter being
 * re-serialized from a record), so a shipped agent keeps its key order, its
 * comments, its `tools` list style and its nested `output:` schema. Keys the
 * file lacks are appended in a stable order, so re-saving an untouched file
 * changes nothing but the key that was edited.
 */
export async function writeAgentDefinition(input: AgentFileInput): Promise<{ path: string }> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(input.fileName)) {
    throw new Error('Agent file name may contain letters, numbers, dots, dashes, and underscores');
  }
  if (!input.systemPrompt.trim()) {
    throw new Error('Agent system prompt cannot be empty');
  }

  const dir = join(getAgentDir(), 'agents');
  const path = join(dir, `${input.fileName}.md`);
  const existing = (await Bun.file(path).exists()) ? await Bun.file(path).text() : '';
  const { lines, missing } = splitDefinition(existing);

  /** Old spellings of keys the panel owns are dropped, so one file cannot carry two. */
  const aliases = new Map<string, OwnedKey>([
    ['thinking', 'thinkingLevel'],
    ['thinking-level', 'thinkingLevel'],
  ]);

  const output: string[] = [];
  const handled = new Set<OwnedKey>();

  for (let index = 0; index < lines.length;) {
    const entry = /^([A-Za-z_][\w-]*)\s*:/.exec(lines[index]);
    if (!entry) {
      output.push(lines[index]);
      index += 1;
      continue;
    }
    const key = entry[1];
    const length = blockLength(lines, index);
    const ownedKey = OWNED_KEYS.includes(key as OwnedKey)
      ? (key as OwnedKey)
      : aliases.get(key) ?? null;
    const keepVerbatim = ownedKey === null || handled.has(ownedKey);
    const rendered = ownedKey === null ? undefined : renderKey(ownedKey, input);
    if (ownedKey !== null) handled.add(ownedKey);
    if (keepVerbatim || rendered === undefined) {
      for (let offset = 0; offset < length; offset++) output.push(lines[index + offset]);
    } else if (rendered) {
      output.push(...rendered);
    }
    index += length;
  }

  for (const key of OWNED_KEYS) {
    if (handled.has(key)) continue;
    const rendered = renderKey(key, input);
    if (rendered) output.push(...rendered);
  }

  const prompt = input.systemPrompt.trim();
  const block = `---\n${output.join('\n')}\n---\n\n${prompt}\n`;
  // A file with no frontmatter fences gets one prepended; nothing it held is lost.
  await writeFileAtomic(path, missing && existing.trim() ? `---\n${output.join('\n')}\n---\n\n${existing.trim()}\n` : block);
  return { path };
}

export async function deleteAgentDefinition(fileName: string): Promise<boolean> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(fileName)) throw new Error('Invalid agent file name');
  const path = join(getAgentDir(), 'agents', `${fileName}.md`);
  if (!(await Bun.file(path).exists())) return false;
  await fs.promises.unlink(path);
  return true;
}
