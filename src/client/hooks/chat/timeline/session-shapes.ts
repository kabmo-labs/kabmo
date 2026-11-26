/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The payload `/api/chat/:id` answers with, and the identity a spawn established
 * before that payload can be trusted.
 *
 * Types only, in their own module: `session-load.ts` owns the fetching and the
 * seeding rules and sits against the per-file size ceiling.
 */

import type { LiveHarnessModels } from '@kabmo-labs/kabmo-app-contracts/harness';

export interface SessionDataShape {
  id?: string;
  title?: string;
  model?: string | { provider: string; modelId: string };
  thinkingLevel?: string;
  messages?: any[];
  /** Harness the live session runs, with the model/thinking selectors it
   *  published. Only a live non-omp session reports them. */
  harness?: string;
  liveModels?: LiveHarnessModels;
  /** An IMPORTED chat whose transcript lives in the agent: the client must ask
   *  the restore command to copy it in before the timeline can show anything. */
  restore?: boolean;
}

/** Session identity a spawn established before omp's JSONL is readable. */
export interface SessionSeed {
  model?: { provider: string; modelId: string } | null;
  thinkingLevel?: string | null;
}
