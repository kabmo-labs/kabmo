/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Resolve the `!command` and bare-env indirections omp applies to MCP `env`
 * and `headers` before it connects.
 *
 * omp's own loader runs a value that starts with `!` as a shell command in the
 * project directory (10s timeout, trimmed stdout) and falls back to an
 * environment variable when the whole value names one. An ACP agent receives
 * the list as a JSON argument and does NOT run that resolution, so passing the
 * raw value hands the agent the literal string `!echo Bearer $(cat …)` — a
 * header no server accepts. The same resolution is what makes the navbar's
 * probe answer for the server the agent actually got.
 *
 * A failed or empty command OMITS the entry, exactly as omp does: a header
 * that cannot be minted is not a header.
 */

import type { McpServer } from '@/server/lib/omp/config/mcp-shared';
import type { McpServerDefinition } from '@/server/lib/mcp/registry.server';

const COMMAND_TIMEOUT_MS = 10_000;

/** Run one `!command` and return its trimmed stdout, or null. */
async function runCommand(command: string, cwd: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(['sh', '-c', command], {
      cwd,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      signal: AbortSignal.timeout(COMMAND_TIMEOUT_MS),
    });
    const [stdout, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);
    if (exitCode !== 0) return null;
    const trimmed = stdout.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

/**
 * One env/header value, resolved the way omp resolves it before connecting.
 * `null` means the entry must be omitted.
 */
export async function resolveMcpValue(value: string, cwd: string): Promise<string | null> {
  if (value.startsWith('!')) return runCommand(value.slice(1), cwd);
  const fromEnv = Bun.env[value];
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv;
  return value;
}

/** Resolve every string value of a map; a failed or non-string entry is dropped. */
async function resolveRecord(
  record: Record<string, unknown>,
  cwd: string,
): Promise<Record<string, string> | undefined> {
  const entries = await Promise.all(
    Object.entries(record).map(async ([key, value]) => {
      if (typeof value !== 'string') return null;
      const resolved = await resolveMcpValue(value, cwd);
      return resolved === null ? null : ([key, resolved] as const);
    }),
  );
  const kept = entries.filter((entry): entry is readonly [string, string] => entry !== null);
  return kept.length > 0 ? Object.fromEntries(kept) : undefined;
}

/**
 * A native `mcp.json` entry with its `env`/`headers` resolved. The rest of the
 * config is copied verbatim, so a caller can still write it back or hand it to
 * the ACP wire shape.
 */
export async function resolveMcpConfig(config: McpServer, cwd: string): Promise<McpServer> {
  const env = config.env && typeof config.env === 'object' && !Array.isArray(config.env)
    ? await resolveRecord(config.env as Record<string, unknown>, cwd)
    : undefined;
  const headers = config.headers && typeof config.headers === 'object' && !Array.isArray(config.headers)
    ? await resolveRecord(config.headers as Record<string, unknown>, cwd)
    : undefined;
  const next: McpServer = { ...config };
  if (env) next.env = env;
  else delete next.env;
  if (headers) next.headers = headers;
  else delete next.headers;
  return next;
}

/** The transport-neutral definition with its `env`/`headers` resolved. */
export async function resolveMcpDefinition(
  definition: McpServerDefinition,
  cwd: string,
): Promise<McpServerDefinition> {
  const env = definition.env ? await resolveRecord(definition.env, cwd) : undefined;
  const headers = definition.headers ? await resolveRecord(definition.headers, cwd) : undefined;
  return {
    ...definition,
    ...(env ? { env } : {}),
    ...(headers ? { headers } : {}),
  };
}
