/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which agent process a session drives: the one it spawns, or a prewarmed one
 * it adopts.
 *
 * Split from `session.ts` for the per-file ceiling, and the decision is worth
 * naming: a prewarmed child was spawned before this session existed, so its
 * notifications, agent→client requests and exit notice are pointing at nobody.
 * Adopting means re-binding those sinks — after that the process is
 * indistinguishable from a cold spawn, and its cached `initialize` is reused.
 */

import { AcpProcess, type AcpClientOptions } from '@/server/lib/harness/acp/client';
import { withGatewayCompatibility } from '@/server/lib/harness/acp/gateway-env';
import type { AcpSessionOptions } from '@/server/lib/harness/acp/session-options';

/** The frame sinks a session supplies; `AcpProcess` re-binds them on adoption. */
export type SessionFrameSinks = Pick<
  AcpClientOptions,
  'onNotification' | 'onClientRequest' | 'onExit' | 'onStderr'
>;

export function openSessionProcess(
  options: AcpSessionOptions,
  cwd: string,
  sinks: SessionFrameSinks,
): AcpProcess {
  if (options.process) {
    options.process.attachSinks(sinks);
    return options.process;
  }
  const env = withGatewayCompatibility(options.harness, options.env);
  return new AcpProcess({
    command: options.command,
    cwd,
    ...(env ? { env } : {}),
    ...sinks,
  });
}
