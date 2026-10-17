/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Native OMP agent discovery — reads agent definition markdown files from
 * ~/.omp/agent/agents and <project>/.omp/agents so the settings agents list
 * surfaces the same agent definitions the omp agent loads. Discovery is
 * read-only: chamber never mutates native agent files.
 */

import fs from 'fs';
import { basename, join } from 'path';
import { getAgentDir, pathExists } from '@/server/lib/omp/core/paths';
import { writeFileAtomic } from '@/server/lib/fs/atomic-write';
import { parseFrontmatter } from '@/server/lib/omp/config/yaml';

export interface DiscoveredAgent {
  id: string;
  name: string;
  description: string;
  mode: 'primary' | 'subagent' | 'all';
  overrideModel?: string;
  thinkingVariant?: string;
  temperature?: number | null;
  topP?: number | null;
  systemPrompt: string;
  /** Which disk root the agent was discovered from. */
  sourceRoot: 'user' | 'project';
  filePath: string;
}

function toMode(value: string | undefined): 'primary' | 'subagent' | 'all' {
  return value === 'primary' || value === 'subagent' || value === 'all' ? value : 'all';
}

async function parseAgentFile(filePath: string, sourceRoot: 'user' | 'project'): Promise<DiscoveredAgent | undefined> {
  try {
    const file = Bun.file(filePath);
    if ((await file.stat()).size > 512 * 1024) return undefined;
    const text = await file.text();
    const { data, body } = parseFrontmatter(text);
    const base = basename(filePath).replace(/\.md$/, '') || filePath;
    const name = data.name || base;
    if (!name) return undefined;
    const temperature = data.temperature !== undefined && data.temperature !== '' ? Number(data.temperature) : null;
    const topP = data.top_p !== undefined && data.top_p !== '' ? Number(data.top_p) : null;
    return {
      id: `omp-${sourceRoot}-${base}`,
      name,
      description: data.description || '',
      mode: toMode(data.mode),
      overrideModel: data.model || undefined,
      thinkingVariant: data.thinking || undefined,
      temperature: Number.isFinite(temperature) ? temperature : null,
      topP: Number.isFinite(topP) ? topP : null,
      systemPrompt: body.trim(),
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

/** Escape a frontmatter scalar value into a safe quoted string. */
function fmValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function optionalFmLine(lines: string[], key: string, value: string | number | null | undefined): void {
  if (value === null || value === undefined || value === '') return;
  lines.push(`${key}: ${typeof value === 'number' ? value : fmValue(String(value))}`);
}

export interface AgentFileInput {
  /** File base name without .md (also the agent name unless name is given). */
  fileName: string;
  name?: string;
  description?: string;
  mode?: string;
  model?: string;
  thinking?: string;
  temperature?: number | null;
  topP?: number | null;
  tools?: string[];
  systemPrompt: string;
}

/**
 * Write (create or replace) a user-level agent definition markdown file.
 * Project agents are intentionally not writable from the chamber — the agent
 * dir belongs to omp.
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
  const lines: string[] = ['---'];
  optionalFmLine(lines, 'name', input.name ?? input.fileName);
  optionalFmLine(lines, 'description', input.description);
  optionalFmLine(lines, 'mode', input.mode);
  optionalFmLine(lines, 'model', input.model);
  optionalFmLine(lines, 'thinking-level', input.thinking);
  optionalFmLine(lines, 'temperature', input.temperature ?? null);
  optionalFmLine(lines, 'top_p', input.topP ?? null);
  if (input.tools && input.tools.length > 0) {
    lines.push(`tools: ${input.tools.map(fmValue).join(', ')}`);
  }
  lines.push('---');
  const content = `${lines.join('\n')}\n\n${input.systemPrompt.trim()}\n`;
  await writeFileAtomic(path, content);
  return { path };
}

export async function deleteAgentDefinition(fileName: string): Promise<boolean> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(fileName)) throw new Error('Invalid agent file name');
  const path = join(getAgentDir(), 'agents', `${fileName}.md`);
  if (!(await Bun.file(path).exists())) return false;
  await fs.promises.unlink(path);
  return true;
}
