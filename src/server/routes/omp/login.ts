/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Provider login flow over a dedicated throwaway omp RPC process.
 *
 * POST returns an SSE stream of `extension_ui_request` frames (open_url for
 * OAuth, input/confirm for API keys, notify for status). The client replies
 * by POSTing `extension_ui_response` frames to the same endpoint; they are
 * forwarded into the running login process. The stream ends when the login
 * command resolves, fails, or the client disconnects.
 */

import { json } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import { RpcProcess } from '@/server/lib/omp/rpc/process';
import { isMockMode } from '@/server/mock.server';
import { createSseStream } from '@/server/lib/sse';

const READY_TIMEOUT_MS = 30_000;
const LOGIN_TIMEOUT_MS = 300_000;

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return methodNotAllowed({ request, params });
  }
  const body = await request.json().catch(() => null);

  // Response forwarding: an in-flight login posts an extension_ui_response frame.
  const isUiResponse = body && typeof body.id === 'string' && body.type === 'extension_ui_response';
  const forward = isUiResponse
    ? (globalThis.__kabmoLoginResponseSink as ((frame: { type: string; [key: string]: unknown }) => void) | undefined)
    : undefined;
  if (forward) {
    forward(body as { type: string; [key: string]: unknown });
    return json({ success: true });
  }

  if (!body || typeof body.providerId !== 'string' || !body.providerId.trim()) {
    return json({ error: 'providerId is required' }, { status: 400 });
  }
  if (isMockMode()) {
    return json({ error: 'Login is unavailable in mock mode' }, { status: 400 });
  }

  const providerId = body.providerId;

  const stream = createSseStream({
    async onStart(handlers) {
      let closed = false;
      let sink: ((frame: Record<string, unknown>) => void) | null = null;

      const cleanup = () => {
        if (closed) return;
        closed = true;
        globalThis.__kabmoLoginResponseSink = undefined;
        handlers.close();
      };
      const send = (data: unknown) => {
        if (closed) return;
        handlers.send('', data);
      };

      globalThis.__kabmoLoginResponseSink = (frame) => sink?.(frame);

      const proc = new RpcProcess({ cwd: '/', extraArgs: ['--no-session', '--no-skills', '--no-lsp'] });
      const onAbort = () => { void proc.dispose(); cleanup(); };
      request.signal?.addEventListener('abort', onAbort, { once: true });

      try {
        const ready = await proc.waitReady(READY_TIMEOUT_MS);
        await proc.negotiateProtocol(ready);
        const unsubscribe = proc.onFrame((frame) => {
          if (frame.type === 'extension_ui_request') send(frame);
        });

        sink = (frame) => proc.sendFrame({ type: 'extension_ui_response', ...frame });

        let loginOk = false;
        let loginError: string | undefined;
        try {
          await proc.sendCommand({ type: 'login', providerId }, LOGIN_TIMEOUT_MS);
          loginOk = true;
        } catch (error) {
          loginError = error instanceof Error ? error.message : String(error);
        } finally {
          unsubscribe();
          send({ type: 'login_result', providerId, success: loginOk, ...(loginError ? { error: loginError } : {}) });
          cleanup();
        }
      } catch (error) {
        send({ type: 'login_result', providerId, success: false, error: error instanceof Error ? error.message : String(error) });
        cleanup();
      } finally {
        request.signal?.removeEventListener('abort', onAbort);
        void proc.dispose();
      }

      return cleanup;
    },
  });

  return stream.response;
}

declare global {
  // eslint-disable-next-line no-var
  var __kabmoLoginResponseSink: ((frame: Record<string, unknown>) => void) | undefined;
}
