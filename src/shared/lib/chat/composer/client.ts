import type { AgentItem, CommandItem, ComposerPickItem, ComposerPickKind, FsFileEntry, SkillItem } from '@/shared/types';
import { KABMO_COMMANDS } from '@/shared/lib/chat/composer/trigger';

const CACHE_TTL_MS = 300_000;

/** Cache keys: `'agent'`, `'command::<root>'`, and `'file::<root>'` per workspace root. */
const AGENTS_KEY = 'agent';
const commandKey = (root: string): string => `command::${root}`;
const fileKey = (root: string): string => `file::${root}`;

interface CacheEntry {
  data: ComposerPickItem[];
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<ComposerPickItem[]>>();

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  const data = (await res.json()) as T;
  if (!data || typeof data !== 'object') {
    throw new Error(`GET ${url} returned malformed JSON`);
  }
  return data;
}

/** Map agent settings into pick items with `@name` tokens. */
export function toAgentPickItems(agents: AgentItem[]): ComposerPickItem[] {
  return agents.map((agent) => ({
    id: `agent-${agent.name}`,
    name: agent.name,
    description: agent.description,
    kind: 'agent',
    source: 'agent',
    token: `@${agent.name}`,
  }));
}

/**
 * Map workspace files into `@file:<path>` mention tokens. The `file:` namespace
 * means a file token can never collide with a bare `@agent` (e.g. a root-level
 * file `sonic` inserts `@file:sonic`, never `@sonic`). Quoted form when the
 * path contains whitespace.
 */
export function toFilePickItems(files: FsFileEntry[]): ComposerPickItem[] {
  return files.map((file) => ({
    id: `file-${file.path}`,
    name: file.path,
    description: '',
    kind: 'file',
    source: 'file',
    token: /\s/.test(file.path) ? `@"file:${file.path}"` : `@file:${file.path}`,
    path: file.path,
  }));
}

/**
 * Combine live command items (`/name`, including omp's own `skill:<name>`
 * entries) with Kabmo's skill list. Commands win: a skill whose plain or
 * `skill:`-namespaced name a command already covers is skipped, so the two
 * sources never double-list the same skill.
 *
 * The Kabmo's own commands (`KABMO_COMMANDS`) lead, so a same-named entry
 * from omp can never advertise behavior the composer overrides on send — `/btw`
 * is reserved by omp in the TUI for the same reason.
 *
 * The description carries the argument hint exactly as oh-my-pi renders it
 * (`[on|off|status] - Toggle fast mode`) so the popup matches the CLI.
 */
export function mergeCommandAndSkillItems(commands: CommandItem[], skills: SkillItem[]): ComposerPickItem[] {
  const result: ComposerPickItem[] = [];
  const seen = new Set<string>();

  for (const command of [...KABMO_COMMANDS, ...commands]) {
    const key = command.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const description = command.description ?? '';
    result.push({
      id: `command-${command.name}`,
      name: command.name,
      description: command.inputHint ? (description ? `${command.inputHint} - ${description}` : command.inputHint) : description,
      kind: command.name.toLowerCase().startsWith('skill:') ? 'skill' : 'command',
      source: command.name.toLowerCase().startsWith('skill:') ? 'skill' : 'command',
      token: `/${command.name}`,
      ...(command.aliases?.length ? { aliases: command.aliases } : {}),
      ...(command.subcommands?.length ? { subcommands: command.subcommands } : {}),
      ...(command.inputHint ? { inputHint: command.inputHint } : {}),
    });
  }

  for (const skill of skills) {
    const plain = skill.name.toLowerCase();
    const prefixed = `skill:${plain}`;
    if (seen.has(plain) || seen.has(prefixed)) continue;
    seen.add(prefixed);
    result.push({
      id: `skill-${skill.name}`,
      name: prefixed,
      description: skill.description,
      kind: 'skill',
      source: 'skill',
      token: `/${prefixed}`,
    });
  }

  return result;
}

/** Load agent items, deduping concurrent callers and caching 5 minutes. */
async function loadAgentItems(): Promise<ComposerPickItem[]> {
  const cached = cache.get(AGENTS_KEY);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const existing = inFlight.get(AGENTS_KEY);
  if (existing) return existing;

  const pending = (async () => {
    try {
      const items = toAgentPickItems(
        (await fetchJson<{ agents: AgentItem[] }>('/api/settings/agents')).agents,
      );
      cache.set(AGENTS_KEY, { data: items, expiresAt: Date.now() + CACHE_TTL_MS });
      return items;
    } finally {
      inFlight.delete(AGENTS_KEY);
    }
  })();

  inFlight.set(AGENTS_KEY, pending);
  return pending;
}

/** Load workspace file items for a root, deduping concurrent callers. Never throws. */
async function loadFileItems(root: string | null): Promise<ComposerPickItem[]> {
  const key = fileKey(root ?? '');
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const existing = inFlight.get(key);
  if (existing) return existing;

  const pending = (async () => {
    try {
      const query = root ? `?root=${encodeURIComponent(root)}` : '';
      const data = await fetchJson<{ files: FsFileEntry[] }>(`/api/fs/list${query}`);
      const items = toFilePickItems(Array.isArray(data.files) ? data.files : []);
      cache.set(key, { data: items, expiresAt: Date.now() + CACHE_TTL_MS });
      return items;
    } catch {
      return [];
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, pending);
  return pending;
}

/** Load command + skill items, deduping concurrent callers and caching 5 minutes. */
async function loadCommandItems(root: string | null): Promise<ComposerPickItem[]> {
  const key = commandKey(root ?? '');
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const existing = inFlight.get(key);
  if (existing) return existing;

  const pending = (async () => {
    try {
      const query = root ? `?root=${encodeURIComponent(root)}` : '';
      const [commands, skills] = await Promise.all([
        fetchJson<{ commands: CommandItem[] }>(`/api/settings/commands${query}`),
        fetchJson<{ skills: SkillItem[] }>(`/api/settings/skills${query}`),
      ]);
      const items = mergeCommandAndSkillItems(commands.commands, skills.skills);
      cache.set(key, { data: items, expiresAt: Date.now() + CACHE_TTL_MS });
      return items;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, pending);
  return pending;
}

/**
 * Load pick items for a trigger kind. `mention` merges agents (first) and
 * workspace files; `command` merges commands and skills, both scoped to `root`
 * so a workspace's own `.omp/commands` and `.omp/skills` are offered.
 */
export function loadComposerItems(
  kind: ComposerPickKind,
  root?: string | null,
): Promise<ComposerPickItem[]> {
  if (kind === 'mention') {
    return Promise.all([loadAgentItems(), loadFileItems(root ?? null)]).then(
      ([agents, files]) => [...agents, ...files],
    );
  }
  return loadCommandItems(root ?? null);
}

/** Load agent names via the shared agent cache. Never throws. */
export async function loadAgentNames(): Promise<string[]> {
  try {
    const items = await loadAgentItems();
    return items.map((item) => item.name);
  } catch {
    return [];
  }
}

/** Clear the cache (and in-flight dedupe) for one key or all keys. A key with
 *  per-root variants (`command::<root>`) is matched by its prefix, so a caller
 *  that names the logical kind clears every workspace's copy. */
export function invalidateComposerCache(key?: string): void {
  if (!key) {
    cache.clear();
    inFlight.clear();
    return;
  }
  for (const cacheKey of [...cache.keys()]) {
    if (cacheKey === key || cacheKey.startsWith(`${key}::`)) cache.delete(cacheKey);
  }
  for (const inFlightKey of [...inFlight.keys()]) {
    if (inFlightKey === key || inFlightKey.startsWith(`${key}::`)) inFlight.delete(inFlightKey);
  }
}
