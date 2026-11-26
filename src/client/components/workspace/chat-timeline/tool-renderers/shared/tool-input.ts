import type { ToolCallData } from '@kabmo-labs/kabmo-chat-contracts/chat';
import { toolInputPath } from '@kabmo-labs/kabmo-chat-tool/tool-input-path';

/**
 * Extract the `path` a tool call's raw arguments name. The keys live in
 * `tool-input-path.ts` because every adapter spells it differently (`path`,
 * `file_path`, `TargetFile`, …) and this module must not carry a second copy.
 */
export function getToolInputPath(input: ToolCallData['input']): string | undefined {
  return toolInputPath(input);
}

/** Extract a string `action` from a tool call's raw arguments (omp sends an
 *  object; the MOCK path may send a JSON string). Returns undefined otherwise. */
export function getToolInputAction(input: ToolCallData['input']): string | undefined {
  if (input && typeof input === 'object' && typeof input.action === 'string') return input.action;
  return undefined;
}
