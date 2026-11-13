/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The MCP servers one session has, the switch that changes them for THAT
 * session only, and the connection probe behind the status icon.
 *
 * The list is the same merge the spawn path uses (`mcpServerEntriesFor`), so
 * the navbar cannot show a server the session did not receive. The delivery
 * decides which sources are real: omp's RPC mode reads its own `mcp.json`
 * files, while an ACP agent receives the full merged list on the handshake.
 *
 * Applying a toggle is transport-specific and the response says which happened:
 *
 *  - `omp-rpc` with an overlay: rewrite the session's `mcp.json` and send
 *    `/mcp reload` — live, no respawn (measured on 18.20.0).
 *  - `omp-rpc` without one: the child read the real file at spawn, so an idle
 *    child is destroyed and the next command respawns it with the overlay. A
 *    busy child keeps its list until the next spawn.
 *  - ACP: the list is a handshake argument. An idle session is destroyed and
 *    the next command respawns it through `resumeRecordedHarnessSession` with
 *    the filtered list. `omp-acp` is excluded because `session/load` on omp
 *    forks the conversation, so it waits for the next spawn.
 *
 * Status is a PROBE, not a guess: omp publishes no MCP state over RPC, so the
 * only honest answer is a real handshake (`probe.server.ts`), run on demand and
 * cached for a minute.
 */

import { json } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowedResponse } from '@/server/lib/route-adapter';
import { resolveSessionRef } from '@/server/lib/sessions/resolve.server';
import { asOmpSession, getLiveSession, harnessOfSession } from '@/server/lib/omp/rpc/session-registry';
import { reloadChildMcp } from '@/server/lib/omp/rpc/reload-mcp';
import { mcpServerEntriesFor, type McpServerSource } from '@/server/lib/mcp/registry.server';
import { readSessionMcpOverrides, writeSessionMcpOverrides } from '@/server/lib/mcp/session-state.server';
import { ensureSessionMcpOverlay } from '@/server/lib/mcp/session-overlay.server';
import { cachedMcpProbe, probeMcpServer } from '@/server/lib/mcp/probe.server';
import { mcpDelivery } from '@/shared/lib/harness/mcp-facts';
import { isRecord } from '@/shared/lib/util/guards';

/** The sources omp's RPC mode can actually read: its own `mcp.json` files. */
const FILE_SOURCES: readonly McpServerSource[] = ['user', 'project'];

export async function getSessionMcp({ params }: LoaderFunctionArgs) {
  const sessionId = params.sessionId;
  if (!sessionId) return json({ error: 'Missing session id' }, { status: 400 });

  const ref = await resolveSessionRef(sessionId);
  const overrides = await readSessionMcpOverrides(sessionId);
  const delivery = ref.harness ? mcpDelivery(ref.harness) : null;
  const servers = ref.cwd
    ? await mcpServerEntriesFor(ref.cwd, {
        overrides,
        sources: delivery === 'omp-config' ? FILE_SOURCES : undefined,
      })
    : [];

  return json({
    sessionId,
    harness: ref.harness,
    delivery,
    live: ref.live,
    servers: servers.map(({ name, transport, source, enabled }) => ({
      name,
      transport,
      source,
      enabled,
      // A fresh cached handshake, so a reopened popover paints the last answer
      // without spawning the server again.
      probe: cachedMcpProbe(sessionId, name) ?? null,
    })),
    overrides,
  });
}

export async function setSessionMcp({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'POST') return methodNotAllowedResponse();
  const sessionId = params.sessionId;
  if (!sessionId) return json({ error: 'Missing session id' }, { status: 400 });

  const body: unknown = await request.json().catch(() => null);
  const name = isRecord(body) && typeof body.name === 'string' ? body.name.trim() : '';
  const enabled = isRecord(body) && body.enabled === true;
  if (!name) return json({ error: 'name is required' }, { status: 400 });

  const ref = await resolveSessionRef(sessionId);
  if (!ref.cwd) return json({ error: 'Session has no working directory' }, { status: 400 });
  const delivery = ref.harness ? mcpDelivery(ref.harness) : null;
  const sources = delivery === 'omp-config' ? FILE_SOURCES : undefined;

  // The configured state is the baseline: a toggle back to it removes the
  // override instead of pinning the old answer forever.
  const base = await mcpServerEntriesFor(ref.cwd, { sources });
  const target = base.find((entry) => entry.name === name);
  if (!target) {
    return json({ error: `MCP server "${name}" is not configured for this session` }, { status: 404 });
  }

  const overrides = await readSessionMcpOverrides(sessionId);
  const next = { ...overrides };
  if (enabled === target.enabled) delete next[name];
  else next[name] = enabled;
  await writeSessionMcpOverrides(sessionId, next);

  const applied = await applySessionMcpChange(sessionId, ref.cwd, next);
  const servers = await mcpServerEntriesFor(ref.cwd, { overrides: next, sources });
  return json({
    success: true,
    sessionId,
    servers: servers.map(({ name: serverName, transport, source, enabled: isEnabled }) => ({
      name: serverName,
      transport,
      source,
      enabled: isEnabled,
      probe: cachedMcpProbe(sessionId, serverName) ?? null,
    })),
    overrides: next,
    ...applied,
  });
}

/**
 * `POST /api/sessions/:sessionId/mcp/probe` — run a real handshake for one
 * server and answer with the result. The body is `{ name }`.
 */
export async function probeSessionMcp({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'POST') return methodNotAllowedResponse();
  const sessionId = params.sessionId;
  if (!sessionId) return json({ error: 'Missing session id' }, { status: 400 });

  const body: unknown = await request.json().catch(() => null);
  const name = isRecord(body) && typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return json({ error: 'name is required' }, { status: 400 });

  const ref = await resolveSessionRef(sessionId);
  if (!ref.cwd) return json({ error: 'Session has no working directory' }, { status: 400 });
  const delivery = ref.harness ? mcpDelivery(ref.harness) : null;
  const overrides = await readSessionMcpOverrides(sessionId);
  const entries = await mcpServerEntriesFor(ref.cwd, {
    overrides,
    sources: delivery === 'omp-config' ? FILE_SOURCES : undefined,
  });
  const entry = entries.find((candidate) => candidate.name === name);
  if (!entry) {
    return json({ error: `MCP server "${name}" is not configured for this session` }, { status: 404 });
  }
  if (!entry.enabled) {
    return json({ ok: false, error: 'Disabled for this session', toolCount: 0, durationMs: 0, checkedAt: Date.now() });
  }

  // A click within the cache window is answered from the last handshake, so
  // reopening the popover does not spawn the server again.
  const cached = cachedMcpProbe(sessionId, name);
  if (cached) return json(cached);

  const probe = await probeMcpServer(sessionId, entry, ref.cwd);
  return json(probe);
}

/** Apply the new overrides to a live child, or say when they will land. */
async function applySessionMcpChange(
  sessionId: string,
  cwd: string,
  overrides: Record<string, boolean>,
): Promise<{ applied: boolean; appliesOnNextSpawn: boolean }> {
  const live = getLiveSession(sessionId);
  if (!live?.isAlive()) return { applied: false, appliesOnNextSpawn: true };

  const harness = harnessOfSession(live);
  if (harness === 'omp-rpc') {
    const wrapper = asOmpSession(live);
    if (!wrapper) return { applied: false, appliesOnNextSpawn: true };
    if (wrapper.mcpOverlay) {
      // `keep`: the child's `PI_CODING_AGENT_DIR` points here, so the directory
      // must survive even when the last override was removed.
      const overlay = await ensureSessionMcpOverlay(sessionId, cwd, overrides, { keep: true });
      if (!overlay) return { applied: false, appliesOnNextSpawn: true };
      const reloaded = await reloadChildMcp(wrapper).catch(() => false);
      return { applied: reloaded, appliesOnNextSpawn: !reloaded };
    }
    // No overlay: this child read the real `mcp.json` at spawn. An idle child
    // is cheap to replace — the next command respawns it with the overlay.
    if (!wrapper.isBusy()) {
      await wrapper.destroyAndWait();
      return { applied: true, appliesOnNextSpawn: false };
    }
    return { applied: false, appliesOnNextSpawn: true };
  }

  // ACP: `session/load` on omp forks the conversation, so an `omp-acp` chat
  // keeps its list until the next spawn rather than losing its id.
  if (harness === 'omp-acp') return { applied: false, appliesOnNextSpawn: true };
  if (!live.isBusy()) {
    await live.destroyAndWait();
    return { applied: true, appliesOnNextSpawn: false };
  }
  return { applied: false, appliesOnNextSpawn: true };
}
