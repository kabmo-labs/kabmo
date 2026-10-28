/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Shared HTTP mapping for errors thrown by the omp RPC layer. Every agent
 * route that awaits an RPC command answers the same way: a 400 carrying a
 * `{ error, code }` envelope, with the code falling back per error class.
 */

import { json } from '@/server/lib/remix-compat';
import { WebRpcError } from '@/server/lib/omp/rpc/constants';
import { RpcCommandError, RpcCommandTimeoutError } from '@/server/lib/omp/rpc/process';
import { SessionOwnedElsewhereError } from '@/server/lib/omp/session/ownership.server';

export function rpcErrorResponse(error: unknown): Response {
  if (error instanceof WebRpcError) {
    return json({ error: error.message, code: error.code }, { status: 400 });
  }
  // A session another process owns is not a failure of this request — it is a
  // request for the wrong instance. 409 + the owning instance's port so the
  // client can move the tab there instead of starting a second writer.
  if (error instanceof SessionOwnedElsewhereError) {
    return json(
      {
        error: error.message,
        code: 'session_owned_elsewhere',
        sessionId: error.sessionId,
        ownerPort: error.ownership.owner?.port ?? null,
      },
      { status: 409 },
    );
  }
  if (error instanceof RpcCommandTimeoutError) {
    return json({ error: error.message, code: 'rpc_command_timeout' }, { status: 400 });
  }
  if (error instanceof RpcCommandError) {
    return json({ error: error.message, code: error.code ?? 'rpc_command_failed' }, { status: 400 });
  }
  return json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
}
