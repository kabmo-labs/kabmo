/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Native omp agents — the definitions omp itself loads.
 *
 * A definition is a markdown file with frontmatter, and the FILE is the only
 * thing omp reads: user agents at `~/.omp/agent/agents/*.md`, project agents at
 * `<workspace>/.omp/agents/*.md`. The panel therefore reads and writes those
 * files directly. It used to keep a mirrored list in Kabmo's SQLite and POST
 * into it, which made "Create Agent" a button that reported success and changed
 * nothing the agent could see.
 *
 * Project agents stay read-only: that directory belongs to the workspace, and a
 * console that rewrites another checkout's definitions is a surprise. The route
 * still lists them, flagged `sourceRoot: 'project'`.
 */

import { json } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import { DEFAULT_AGENTS_LIST } from '@/client/data/agent-data';
import { isMockMode } from '@/server/mock.server';
import { join } from 'path';
import {
  deleteAgentDefinition,
  discoverNativeAgents,
  writeAgentDefinition,
  type DiscoveredAgent,
} from '@/server/lib/omp/config/agents';
import { agentFileBaseName } from '@/shared/lib/omp/config/agent-file';
import { resolveRoot } from '@/server/lib/fs/root';
import type { AgentItem } from '@/shared/types';

/** Project agents are listed but never written from here. */
function toAgentItem(agent: DiscoveredAgent): AgentItem {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description || `omp agent (${agent.sourceRoot})`,
    scope: agent.sourceRoot === 'user' ? 'user' : 'project',
    ...(agent.tools ? { tools: agent.tools } : {}),
    ...(agent.spawns ? { spawns: agent.spawns } : {}),
    ...(agent.model ? { model: agent.model } : {}),
    ...(agent.thinkingLevel ? { thinkingLevel: agent.thinkingLevel } : {}),
    systemPrompt: agent.systemPrompt,
    isBuiltIn: agent.sourceRoot !== 'user',
    filePath: agent.filePath,
    fileName: agentFileBaseName(agent.filePath),
    sourceRoot: agent.sourceRoot,
  };
}

async function readList(projectRoot: string | null): Promise<AgentItem[]> {
  const projectDir = projectRoot
    ? join(await resolveRoot(projectRoot, ''), '.omp', 'agents')
    : undefined;
  return (await discoverNativeAgents(projectDir)).map(toAgentItem);
}

export async function loader({ request }: LoaderFunctionArgs) {
  const mock = isMockMode();
  if (mock) return json({ agents: DEFAULT_AGENTS_LIST, isMock: true });
  try {
    const url = new URL(request.url);
    const root = url.searchParams.get('root');
    return json({ agents: await readList(root), isMock: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: message, agents: [], isMock: false }, { status: 500 });
  }
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return methodNotAllowed({ request, params });
  }
  if (isMockMode()) {
    return json({ error: 'Agent files cannot be written in mock mode' }, { status: 400 });
  }
  try {
    const body: unknown = await request.json();
    if (typeof body !== 'object' || body === null || !('type' in body)) {
      return json({ error: 'type is required (write or delete)' }, { status: 400 });
    }
    const root = 'root' in body && typeof body.root === 'string' ? body.root : null;

    if (body.type === 'delete') {
      if (!('fileName' in body) || typeof body.fileName !== 'string') {
        return json({ error: 'fileName is required' }, { status: 400 });
      }
      const removed = await deleteAgentDefinition(body.fileName);
      if (!removed) return json({ error: `No agent file named “${body.fileName}”` }, { status: 404 });
      return json({ success: true, agents: await readList(root) });
    }

    if (body.type === 'write') {
      const fileName = 'fileName' in body && typeof body.fileName === 'string' ? body.fileName : '';
      const systemPrompt = 'systemPrompt' in body && typeof body.systemPrompt === 'string' ? body.systemPrompt : '';
      const text = (key: string): string | undefined => (
        key in body && typeof body[key as keyof typeof body] === 'string'
          ? String(body[key as keyof typeof body])
          : undefined
      );
      const tools = 'tools' in body && Array.isArray(body.tools)
        ? body.tools.filter((item): item is string => typeof item === 'string')
        : undefined;
      const written = await writeAgentDefinition({
        fileName,
        name: text('name') ?? fileName,
        description: text('description') ?? '',
        ...(text('model') ? { model: text('model') } : {}),
        ...(text('thinkingLevel') ? { thinkingLevel: text('thinkingLevel') } : {}),
        ...(text('spawns') ? { spawns: text('spawns') } : {}),
        ...(tools ? { tools } : {}),
        systemPrompt,
      });
      // A rename writes the new file and removes the old one, so one definition
      // cannot survive under two names.
      const previous = 'previousFileName' in body && typeof body.previousFileName === 'string'
        ? body.previousFileName
        : '';
      if (previous && previous !== fileName) await deleteAgentDefinition(previous);
      return json({ success: true, path: written.path, agents: await readList(root) });
    }

    return json({ error: `Unknown action “${String(body.type)}”` }, { status: 400 });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
