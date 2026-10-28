/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Provider login flow over a dedicated throwaway omp RPC process.
 *
 * POST returns an SSE stream of `extension_ui_request` frames — `open_url` for
 * OAuth, `input` for a pasted code, `notify` for status. The client replies by
 * POSTing `extension_ui_response` frames to the same endpoint; they are
 * forwarded into the running login process. The stream ends when the login
 * command resolves, fails, or the client disconnects.
 *
 * Two shapes in the `open_url` frame matter and each was a bug:
 *
 * - `url` is the authorization URL and is ALWAYS present; `launchUrl` is an
 *   optional loopback shortcut that omp omits for manual-input-only flows and
 *   for non-loopback redirect URIs. A client that keys on `launchUrl` cancels
 *   the login the moment it is absent.
 * - the flow may be a DEVICE flow, where `instructions` carries the code the
 *   user has to type on another device. That text is the only way to finish it.
 *
 * Each stream owns a `loginId`, because the response sink used to be ONE global
 * slot: two tabs logging in at once overwrote each other, and whichever
 * finished first deleted the other's sink, so the survivor's replies were
 * dropped with no error anywhere.
 */

import { json } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import { RpcProcess } from '@/server/lib/omp/rpc/process';
import { isMockMode } from '@/server/mock.server';
import { createSseStream } from '@/server/lib/sse';

const READY_TIMEOUT_MS = 30_000;
const LOGIN_TIMEOUT_MS = 300_000;

type UiFrameSink = (frame: { type: string; [key: string]: unknown }) => void;

/** Every in-flight login, keyed by its own id. */
function loginSinks(): Map<string, UiFrameSink> {
  if (!globalThis.__kabmoLoginSinks) globalThis.__kabmoLoginSinks = new Map();
  return globalThis.__kabmoLoginSinks;
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return methodNotAllowed({ request, params });
  }
  const body = await request.json().catch(() => null);

  // Response forwarding: an in-flight login posts an extension_ui_response.
  if (body && typeof body.id === 'string' && body.type === 'extension_ui_response') {
    const loginId = typeof body.loginId === 'string' ? body.loginId : '';
    const forward = loginId ? loginSinks().get(loginId) : undefined;
    if (!forward) {
      // Naming the expiry is the difference between "this dialog is stale,
      // reopen it" and a click that appears to do nothing.
      return json({ error: 'This login session has ended — reopen the sign-in dialog.' }, { status: 409 });
    }
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
  const loginId = crypto.randomUUID();

  const stream = createSseStream({
    async onStart(handlers) {
      let closed = false;
      let sink: UiFrameSink | null = null;

      const cleanup = () => {
        if (closed) return;
        closed = true;
        loginSinks().delete(loginId);
        handlers.close();
      };
      const send = (data: unknown) => {
        if (closed) return;
        handlers.send('', data);
      };

      loginSinks().set(loginId, (frame) => sink?.(frame));
      send({ type: 'login_started', loginId, providerId });

      const proc = new RpcProcess({ cwd: '/', extraArgs: ['--no-session', '--no-skills', '--no-lsp'] });
      const onAbort = () => { void proc.dispose(); cleanup(); };
      request.signal?.addEventListener('abort', onAbort, { once: true });

      try {
        const ready = await proc.waitReady(READY_TIMEOUT_MS);
        await proc.negotiateProtocol(ready);
        const unsubscribe = proc.onFrame((frame) => {
          if (frame.type === 'extension_ui_request') send(frame);
        });

        sink = (frame) => proc.sendFrame({ ...frame, type: 'extension_ui_response' });

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
  var __kabmoLoginSinks: Map<string, UiFrameSink> | undefined;
}
