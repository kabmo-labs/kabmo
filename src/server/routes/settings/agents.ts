import { json } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import { getDb } from '@/server/db.server';
import { DEFAULT_AGENTS_LIST } from '@/client/data/agent-data';
import { isMockMode } from '@/server/mock.server';
import type { AgentItem } from '@/shared/types';
import { createSettingsListStore } from '@/server/lib/db/settings-store';
import { deleteAgentDefinition, discoverNativeAgents, writeAgentDefinition, type DiscoveredAgent } from '@/server/lib/omp/config/agents';

const agentsStore = createSettingsListStore<AgentItem>({
  key: 'omp_agents',
  mockDefaults: DEFAULT_AGENTS_LIST,
  idOf: (agent) => agent.id,
  singular: 'agent',
  plural: 'agents',
});

/**
 * Convert a natively discovered omp agent into Kabmo AgentItem shape.
 * Native agents are surfaced as read-only built-ins (isBuiltIn) so the UI
 * lists them alongside app-local custom agents without offering edits that
 * would silently not persist.
 */
function nativeToAgentItem(agent: DiscoveredAgent): AgentItem & { sourceRoot: string } {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description || `Native omp agent (${agent.sourceRoot})`,
    scope: agent.sourceRoot === 'user' ? 'user' : 'project',
    mode: agent.mode,
    overrideModel: agent.overrideModel,
    thinkingVariant: agent.thinkingVariant,
    temperature: agent.temperature,
    topP: agent.topP,
    systemPrompt: agent.systemPrompt,
    isBuiltIn: true,
    sourceRoot: agent.sourceRoot,
  };
}

/** Merge native omp agents (disk discovery) with app-local custom agents. */
async function mergeAgents(custom: AgentItem[]): Promise<Array<AgentItem & { sourceRoot?: string }>> {
  const native = (await discoverNativeAgents()).map(nativeToAgentItem);
  const nativeNames = new Set(native.map((a) => a.name.toLowerCase()));
  return [...native, ...custom.filter((a) => !nativeNames.has(a.name.toLowerCase()))];
}

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const db = await getDb();
    const url = new URL(request.url);
    const includeNative = url.searchParams.get('native') === '1' || !isMockMode();
    const mock = isMockMode();
    const agents = await agentsStore.read(db);

    if (includeNative && !mock) {
      return json({ agents: await mergeAgents(agents), isMock: mock });
    }

    return json({ agents, isMock: mock });
  } catch (error: any) {
    return json({ error: error.message, agents: isMockMode() ? DEFAULT_AGENTS_LIST : [], isMock: isMockMode() }, { status: 500 });
  }
}

export async function action({ request, params }: ActionFunctionArgs) {
  try {
    const db = await getDb();

    if (request.method === 'DELETE') {
      const url = new URL(request.url);
      const id = url.searchParams.get('id');
      if (!id) {
        return json({ error: 'id is required' }, { status: 400 });
      }
      if (id.startsWith('omp-')) {
        return json({ error: 'Native omp agents are read-only in Kabmo' }, { status: 403 });
      }

      const list = await agentsStore.remove(db, id);
      return json({ success: true, agents: list });
    }

    if (request.method === 'POST' || request.method === 'PUT') {
      const body = await request.json();

      // Native agent file write: { type: "write_native", fileName, ...definition }
      if (body.type === 'write_native') {
        if (isMockMode()) return json({ error: 'Native agent writes are unavailable in mock mode' }, { status: 400 });
        const written = await writeAgentDefinition({
          fileName: String(body.fileName ?? ''),
          name: typeof body.name === 'string' ? body.name : undefined,
          description: typeof body.description === 'string' ? body.description : undefined,
          mode: typeof body.mode === 'string' ? body.mode : undefined,
          model: typeof body.model === 'string' ? body.model : undefined,
          thinking: typeof body.thinking === 'string' ? body.thinking : undefined,
          temperature: typeof body.temperature === 'number' ? body.temperature : null,
          topP: typeof body.topP === 'number' ? body.topP : null,
          tools: Array.isArray(body.tools) ? body.tools.map(String) : undefined,
          systemPrompt: String(body.systemPrompt ?? ''),
        });
        return json({ success: true, path: written.path, agents: await mergeAgents([]) });
      }

      // Native agent file delete: { type: "delete_native", fileName }
      if (body.type === 'delete_native') {
        if (isMockMode()) return json({ error: 'Native agent deletes are unavailable in mock mode' }, { status: 400 });
        const removed = await deleteAgentDefinition(String(body.fileName ?? ''));
        if (!removed) return json({ error: 'Native agent file not found' }, { status: 404 });
        return json({ success: true, agents: await mergeAgents([]) });
      }

      if (!Array.isArray(body) && !Array.isArray(body.agents) && body.agent
        && typeof body.agent.id === 'string' && body.agent.id.startsWith('omp-')) {
        return json({ error: 'Native omp agents are read-only in Kabmo' }, { status: 403 });
      }

      const updatedAgents = await agentsStore.upsert(db, body);
      await agentsStore.write(db, updatedAgents);
      return json({ success: true, agents: updatedAgents });
    }

    return methodNotAllowed({ request, params });
  } catch (error: any) {
    return json({ error: error.message }, { status: 500 });
  }
}
