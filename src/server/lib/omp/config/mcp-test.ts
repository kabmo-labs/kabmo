/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Real MCP JSON-RPC 2.0 connectivity test. `command` transport spawns the
 * configured command and runs the stdio initialize → notifications/initialized
 * → tools/list exchange (one JSON object per line); `link` transport POSTs
 * `initialize` to the HTTP/SSE endpoint. The child is always torn down (stdin
 * EOF, SIGTERM, then SIGKILL) so no orphan survives; MOCK mode returns a
 * deterministic result without ever spawning.
 */

import type { Subprocess } from 'bun';
import { stripChamberHostEnv } from '@kabmo-labs/plugin-sdk';
import { killProcessTree } from '@/server/lib/lifecycle/kill-tree';
import { readLines } from '@/server/lib/omp/rpc/lines';
import { isMockMode } from '@/server/mock.server';
import type { McpServerItem } from '@/shared/types';
import { isRecord } from '@/shared/lib/util/guards';

export type McpTransport = 'command' | 'link';

export interface McpTestResult {
  ok: boolean;
  transport: McpTransport;
  protocolVersion?: string;
  serverInfo?: { name?: string; version?: string };
  toolCount?: number;
  durationMs: number;
  error?: string;
}

const HANDSHAKE_TIMEOUT_MS = 15_000;
const LINK_TIMEOUT_MS = 10_000;
const PROTOCOL_VERSION = '2025-06-18';
const REDACTED_SENTINEL = '••••••••';
const STDERR_TAIL_LIMIT = 8 * 1024;
const GRACE_PERIOD_MS = 2_000;

const CLIENT_INFO = { name: 'ompchamber', version: '1.0.0' };

interface HandshakeOutcome {
  protocolVersion?: string;
  serverInfo?: { name?: string; version?: string };
  toolCount?: number;
}

function parseServerInfo(value: unknown): { name?: string; version?: string } | undefined {
  if (!isRecord(value)) return undefined;
  const info: { name?: string; version?: string } = {};
  if (typeof value.name === 'string') info.name = value.name;
  if (typeof value.version === 'string') info.version = value.version;
  return info.name !== undefined || info.version !== undefined ? info : undefined;
}

function describeError(value: unknown): string {
  if (typeof value === 'string' && value.length > 0) return value;
  if (isRecord(value) && typeof value.message === 'string') return value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return 'Unknown error';
  }
}

function initializeRequest(): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO },
  };
}

/** Merge configured env vars over the sanitized env, skipping empty values and
 * the redaction sentinel so masked credentials are never replayed. */
function mergeEnvVars(server: McpServerItem): NodeJS.ProcessEnv {
  const env = stripChamberHostEnv(Bun.env, process.platform);
  for (const item of server.envVars ?? []) {
    const key = item?.key?.trim();
    const value = item?.value;
    if (!key || value === undefined || value === null || value === '' || value === REDACTED_SENTINEL) continue;
    env[key] = value;
  }
  return env;
}

/** Mirror `RpcProcess.dispose`: stdin EOF, then SIGTERM, then SIGKILL on the
 * whole process group; resolves once the child has exited so no orphan stays. */
function disposeChild(child: Subprocess<"pipe", "pipe", "pipe">): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const termTimer = setTimeout(() => {
      if (!settled) killProcessTree(child.pid, false, 'SIGTERM');
    }, GRACE_PERIOD_MS);
    const killTimer = setTimeout(() => {
      if (!settled) killProcessTree(child.pid, true, 'SIGKILL');
    }, GRACE_PERIOD_MS * 2);
    termTimer.unref?.();
    killTimer.unref?.();
    const settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(termTimer);
      clearTimeout(killTimer);
      resolve();
    };
    try {
      child.stdin?.end();
    } catch {
      // stdin may already be closed; the exit listener settles the promise.
    }
    void child.exited.then(settle);
    if (child.exitCode !== null || child.signalCode !== null) settle();
  });
}

function runHandshake(
  child: Subprocess<"pipe", "pipe", "pipe">,
  getStderrTail: () => string,
): Promise<HandshakeOutcome> {
  return new Promise<HandshakeOutcome>((resolve, reject) => {
    let settled = false;

    const overallTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`MCP handshake timed out after ${HANDSHAKE_TIMEOUT_MS}ms`));
    }, HANDSHAKE_TIMEOUT_MS);
    overallTimer.unref?.();

    const succeed = (value: HandshakeOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(overallTimer);
      resolve(value);
    };
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(overallTimer);
      reject(new Error(message));
    };

    let init: { protocolVersion?: string; serverInfo?: { name?: string; version?: string } } | null = null;

    const send = (message: unknown) => {
      const stdin = child.stdin;
      if (!stdin) return;
      try {
        stdin.write(`${JSON.stringify(message)}\n`);
      } catch {
        // stdin may already be closed while the child is dying.
      }
    };

    void readLines(child.stdout, (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        return; // ignore non-JSON banner/log output on stdout
      }
      if (!isRecord(parsed)) return;
      const id = parsed.id;
      if (id === 1 || id === '1') {
        if (parsed.error !== undefined) {
          fail(`MCP initialize failed: ${describeError(parsed.error)}`);
          return;
        }
        const result = isRecord(parsed.result) ? parsed.result : undefined;
        init = {
          protocolVersion: typeof result?.protocolVersion === 'string' ? result.protocolVersion : undefined,
          serverInfo: result ? parseServerInfo(result.serverInfo) : undefined,
        };
        send({ jsonrpc: '2.0', method: 'notifications/initialized' });
        send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
        return;
      }
      if (id === 2 || id === '2') {
        if (parsed.error !== undefined) {
          fail(`MCP tools/list failed: ${describeError(parsed.error)}`);
          return;
        }
        const tools = isRecord(parsed.result) ? parsed.result.tools : undefined;
        succeed({
          protocolVersion: init?.protocolVersion,
          serverInfo: init?.serverInfo,
          toolCount: Array.isArray(tools) ? tools.length : undefined,
        });
      }
    });

    void child.exited.then((code) => {
      const tail = getStderrTail();
      const suffix = tail ? `: ${tail.slice(-500)}` : '';
      fail(`Server exited before completing handshake (code ${code ?? 'null'}, signal ${child.signalCode ?? 'none'})${suffix}`);
    });

    send(initializeRequest());
  });
}

async function runCommandTest(server: McpServerItem, cwd: string | undefined): Promise<McpTestResult> {
  const commandArgs = (server.commandArgs ?? []).map((arg) => arg.trim()).filter((arg) => arg.length > 0);
  const startedAt = Date.now();
  if (commandArgs.length === 0) {
    return { ok: false, transport: 'command', durationMs: 0, error: 'No command configured' };
  }

  const child: Subprocess<"pipe", "pipe", "pipe"> = Bun.spawn({
    cmd: commandArgs,
    cwd: cwd || process.cwd(),
    env: mergeEnvVars(server),
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    windowsHide: true,
    detached: process.platform !== 'win32',
  });

  let stderrTail = '';
  void readLines(child.stderr, (line) => {
    stderrTail = (stderrTail + line + '\n').slice(-STDERR_TAIL_LIMIT);
  });

  try {
    const outcome = await runHandshake(child, () => stderrTail);
    return {
      ok: true, transport: 'command', protocolVersion: outcome.protocolVersion,
      serverInfo: outcome.serverInfo, toolCount: outcome.toolCount, durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      ok: false, transport: 'command', durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : 'MCP handshake failed',
    };
  } finally {
    await disposeChild(child);
  }
}

function extractSseData(text: string): unknown {
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    try {
      return JSON.parse(data);
    } catch {
      // skip malformed frames; keep scanning for the first parseable data line
    }
  }
  return undefined;
}

function extractInitializeOutcome(payload: unknown): HandshakeOutcome {
  const result = isRecord(payload) && isRecord(payload.result) ? payload.result : payload;
  if (!isRecord(result)) return {};
  return {
    protocolVersion: typeof result.protocolVersion === 'string' ? result.protocolVersion : undefined,
    serverInfo: parseServerInfo(result.serverInfo),
  };
}

async function runLinkTest(url: string): Promise<McpTestResult> {
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify(initializeRequest()),
      signal: AbortSignal.timeout(LINK_TIMEOUT_MS),
    });
    if (!response.ok) {
      return {
        ok: false,
        transport: 'link',
        durationMs: Date.now() - startedAt,
        error: `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`,
      };
    }
    const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
    const payload = contentType.includes('text/event-stream')
      ? extractSseData(await response.text())
      : await response.json();
    const outcome = extractInitializeOutcome(payload);
    return {
      ok: true,
      transport: 'link',
      protocolVersion: outcome.protocolVersion,
      serverInfo: outcome.serverInfo,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      ok: false,
      transport: 'link',
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : 'Connection failed',
    };
  }
}

function mockTestResult(server: McpServerItem): McpTestResult {
  const valid = server.reachType === 'command'
    ? (server.commandArgs ?? []).some((arg) => arg.trim().length > 0)
    : typeof server.linkUrl === 'string' && /^https?:\/\//i.test(server.linkUrl);
  if (!valid) {
    return { ok: false, transport: server.reachType, durationMs: 12, error: 'Invalid server configuration' };
  }
  return {
    ok: true,
    transport: server.reachType,
    protocolVersion: PROTOCOL_VERSION,
    serverInfo: { name: server.name || undefined, version: '1.0.0' },
    toolCount: 3,
    durationMs: 37,
  };
}

/** Run a real MCP handshake; resolves with a result record (never throws for a
 * failed connection). Only truly unexpected errors reject, mapped to a 500 by
 * the route without leaking env or secrets. */
export async function testMcpServer(input: { server: McpServerItem; cwd?: string }): Promise<McpTestResult> {
  const { server, cwd } = input;

  if (isMockMode()) {
    return mockTestResult(server);
  }

  if (server.reachType === 'link') {
    const url = (server.linkUrl ?? '').trim();
    if (!/^https?:\/\//i.test(url)) {
      return { ok: false, transport: 'link', durationMs: 0, error: 'Link URL must be a valid http(s) endpoint' };
    }
    return runLinkTest(url);
  }

  return runCommandTest(server, cwd);
}
