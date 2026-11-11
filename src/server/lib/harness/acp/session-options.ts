/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * How one ACP session is spawned.
 *
 * Its own module because the type is the transport's spawn contract, read by
 * `AcpSession` and handed to it by both callers (`spawn.server.ts` for a chat,
 * `acp-audit.server.ts` for a disposable reader); keeping it in `session.ts`
 * made that file carry a second responsibility past its size ceiling.
 */

import type { ApprovalMode } from '@/shared/lib/omp/config/access-mode';
import type { HarnessId } from '@/shared/lib/harness/catalog';
import type { AcpProcess } from '@/server/lib/harness/acp/client';

export interface AcpSessionOptions {
  harness: HarnessId;
  command: string[];
  env?: Record<string, string>;
  /**
   * A process that has already been spawned and `initialize`d — a prewarmed
   * agent. The session adopts it, so the handshake it runs costs only
   * `session/new` and the config writes; the frame sinks are re-bound here.
   */
  process?: AcpProcess;
  /** Provider/model this session starts on, applied with
   *  `session/set_config_option` right after `session/new`. */
  model?: { provider: string; modelId: string } | null;
  thinkingLevel?: string | null;
  mode?: string | null;
  /** The composer's access pick. ACP has no spawn flag for it, so the session
   *  answers `session/request_permission` itself according to this tier. */
  accessMode?: ApprovalMode | null;
  /** Quiet window before the child is reclaimed; defaults to the omp window so
   *  both transports release an idle agent after the same time. */
  idleDestroyMs?: number;
}
