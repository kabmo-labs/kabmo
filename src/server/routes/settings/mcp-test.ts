import { json } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import { testMcpServer } from '@/server/lib/omp/config/mcp-test';
import type { McpServerItem } from '@/shared/types';

/**
 * POST /api/settings/mcp-test — runs a real MCP JSON-RPC 2.0 handshake
 * against the supplied server configuration. Body: { server: McpServerItem,
 * cwd?: string }. Returns 200 with a `McpTestResult` (ok:false on a failed
 * handshake, not a 500) and 400 on malformed input.
 */

function isMcpKeyValue(value: unknown): value is { id: string; key: string; value: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string' && typeof v.key === 'string' && typeof v.value === 'string';
}

function isMcpServerItem(value: unknown): value is McpServerItem {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    (v.scope === 'every-project' || v.scope === 'this-project') &&
    typeof v.enabled === 'boolean' &&
    (v.transport === 'stdio' || v.transport === 'http' || v.transport === 'sse') &&
    Array.isArray(v.commandArgs) &&
    v.commandArgs.every((arg) => typeof arg === 'string') &&
    (v.linkUrl === undefined || typeof v.linkUrl === 'string') &&
    Array.isArray(v.envVars) &&
    v.envVars.every(isMcpKeyValue) &&
    (v.headers === undefined || (Array.isArray(v.headers) && v.headers.every(isMcpKeyValue)))
  );
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return methodNotAllowed({ request, params });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { server, cwd } = body as { server?: unknown; cwd?: unknown };
  if (!isMcpServerItem(server)) {
    return json({ error: 'Malformed server input' }, { status: 400 });
  }
  if (cwd !== undefined && typeof cwd !== 'string') {
    return json({ error: 'cwd must be a string' }, { status: 400 });
  }

  try {
    const result = await testMcpServer({ server, cwd });
    return json(result);
  } catch {
    // Truly unexpected internal error — never leak env, secrets, or stack.
    return json(
      { ok: false, transport: server.transport, durationMs: 0, error: 'Internal error during MCP test' },
      { status: 500 },
    );
  }
}
