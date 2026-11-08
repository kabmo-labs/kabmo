/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `get_state` for an ACP session — the one snapshot every omp-shaped consumer
 * reads (the composer's selectors, the context panel, the generating
 * indicator's model).
 *
 * A free function over a narrow view rather than a method, because none of it is
 * ACP: the fields are the ones the omp transport reports for the same command,
 * and building them here is what keeps the session class to the parts that
 * actually speak the protocol.
 *
 * `messageCount` is the session's own tally (prompts sent plus assistant
 * messages the mapper closed) — omp reports the same quantity from its
 * transcript, and a hard-coded 0 made the context panel describe a chat with no
 * history.
 */

import { configOption, modelFromOption } from '@/server/lib/harness/acp/prompt';
import type { AcpConfigOption } from '@/server/lib/harness/acp/protocol';
import type { HarnessId } from '@/shared/lib/harness/catalog';

export interface AcpStateView {
  sessionId: string;
  isStreaming: boolean;
  isPromptRunning: boolean;
  messageCount: number;
  promptCount: number;
  assistantCount: number;
  contextUsage: { tokens: number; contextWindow: number; percent: number } | null;
  totalCost: number;
  runModel: { provider: string; modelId: string } | null;
  configOptions: AcpConfigOption[];
  harness: HarnessId;
}

export function acpWebState(view: AcpStateView): Record<string, unknown> {
  const thinking = configOption(view.configOptions, 'thought_level');
  // The run's model is seeded at `start()` and refreshed by every config write,
  // so this is the value the agent RESOLVED — which is what the run indicator
  // must report, since an alias or a fallback can differ from the request. The
  // fallback exists only for a session whose selector list never carried a model.
  const serving = view.runModel ?? modelFromOption(configOption(view.configOptions, 'model'), view.harness);
  return {
    sessionId: view.sessionId,
    isStreaming: view.isStreaming,
    isPromptRunning: view.isPromptRunning,
    isCompacting: false,
    messageCount: view.messageCount,
    userCount: view.promptCount,
    assistantCount: view.assistantCount,
    ...(view.contextUsage ? { contextUsage: view.contextUsage } : {}),
    totalCost: view.totalCost,
    model: serving ? { id: serving.modelId, provider: serving.provider } : undefined,
    thinkingLevel: typeof thinking?.currentValue === 'string' ? thinking.currentValue : undefined,
    configOptions: view.configOptions,
  };
}
