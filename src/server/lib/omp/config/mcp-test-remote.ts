/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The remote half of the MCP connection test: streamable HTTP and legacy SSE.
 *
 * They are separate probes because they are separate handshakes. HTTP POSTs
 * `initialize` and reads the answer from the response; SSE opens a stream, waits
 * for the server to announce a POST endpoint, sends `initialize` there, and
 * reads the answer back off the same stream. Sending an HTTP POST to an SSE
 * endpoint — the previous behaviour — cannot succeed.
 */

import type { McpTestResult } from '@/server/lib/omp/config/mcp-test-protocol';
import {
  describeError,
  extractInitializeOutcome,
  extractSseData,
  initializeRequest,
  type HandshakeOutcome,
} from '@/server/lib/omp/config/mcp-test-protocol';
import { isRecord } from '@/shared/lib/util/guards';

const LINK_TIMEOUT_MS = 10_000;

export async function runLinkTest(url: string, headers: Record<string, string>): Promise<McpTestResult> {
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify(initializeRequest()),
      signal: AbortSignal.timeout(LINK_TIMEOUT_MS),
    });
    if (!response.ok) {
      return {
        ok: false,
        transport: 'http',
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
      transport: 'http',
      protocolVersion: outcome.protocolVersion,
      serverInfo: outcome.serverInfo,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      ok: false,
      transport: 'http',
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : 'Connection failed',
    };
  }
}

interface SseFrame {
  event: string;
  data: string;
}

function parseSseFrame(frame: string): SseFrame {
  let event = 'message';
  const data: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).trim());
  }
  return { event, data: data.join('\n') };
}

export async function runSseTest(url: string, headers: Record<string, string>): Promise<McpTestResult> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LINK_TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers: { ...headers, Accept: 'text/event-stream' }, signal: controller.signal });
    if (!response.ok || !response.body) {
      return {
        ok: false,
        transport: 'sse',
        durationMs: Date.now() - startedAt,
        error: `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`,
      };
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let endpoint: string | null = null;
    let outcome: HandshakeOutcome | null = null;
    while (!outcome) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const frame = parseSseFrame(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        if (frame.event === 'endpoint' && frame.data) {
          endpoint = new URL(frame.data, url).toString();
          void fetch(endpoint, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(initializeRequest()),
            signal: controller.signal,
          }).catch(() => undefined);
        } else if (frame.data) {
          let payload: unknown;
          try {
            payload = JSON.parse(frame.data);
          } catch {
            payload = undefined;
          }
          if (isRecord(payload) && (payload.id === 1 || payload.id === '1')) {
            if (payload.error !== undefined) {
              return {
                ok: false,
                transport: 'sse',
                durationMs: Date.now() - startedAt,
                error: `MCP initialize failed: ${describeError(payload.error)}`,
              };
            }
            outcome = extractInitializeOutcome(payload);
          }
        }
        boundary = buffer.indexOf('\n\n');
      }
    }
    if (!outcome) {
      return {
        ok: false,
        transport: 'sse',
        durationMs: Date.now() - startedAt,
        error: endpoint
          ? 'The SSE stream closed before initialize answered'
          : 'The SSE stream did not announce a POST endpoint',
      };
    }
    return {
      ok: true,
      transport: 'sse',
      protocolVersion: outcome.protocolVersion,
      serverInfo: outcome.serverInfo,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      ok: false,
      transport: 'sse',
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : 'Connection failed',
    };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
