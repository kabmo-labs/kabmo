/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Content-block profiling for raw session telemetry: maps an omp message
 * content value to the coarse badge categories and char counts the raw
 * messages panel renders. Extracted from ./telemetry.ts to keep that module
 * under the repo's per-file size ceiling.
 */

import { isRecord } from '@/shared/lib/util/guards';

export const TYPE_ORDER = ['reasoning', 'text', 'bash', 'read', 'edit', 'search', 'web', 'tool'] as const;

/** Coarse badge category for a tool name (mirrors the mock taxonomy). */
function toolCategory(name: string | undefined): string {
  const lower = (name || '').toLowerCase();
  if (/bash|terminal|shell/.test(lower)) return 'bash';
  if (/cmd|command|run|exec/.test(lower)) return 'bash';
  if (/write|edit|patch|apply|create/.test(lower)) return 'edit';
  if (/read|view|list|cat/.test(lower)) return 'read';
  if (/search|grep|find|glob/.test(lower)) return 'search';
  if (/web|fetch|http|browser/.test(lower)) return 'web';
  return 'tool';
}

export function contentProfile(content: unknown): { parts: string[]; toolCalls: number; toolChars: number } {
  if (!Array.isArray(content)) return { parts: typeof content === 'string' && content.trim() ? ['text'] : [], toolCalls: 0, toolChars: 0 };
  const seen = new Set<string>();
  let toolCalls = 0;
  let toolChars = 0;
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block.type === 'thinking') seen.add('reasoning');
    else if (block.type === 'text') seen.add('text');
    else if (block.type === 'toolCall') {
      toolCalls++;
      seen.add(toolCategory(typeof block.name === 'string' ? block.name : undefined));
      try {
        toolChars += JSON.stringify(block.arguments ?? {}).length;
      } catch {
        // ignore serialization failure
      }
    } else if (block.type === 'toolResult') {
      try {
        toolChars += JSON.stringify(block).length;
      } catch {
        // ignore serialization failure
      }
    }
    if (typeof block.command === 'string') {
      seen.add('bash');
      toolChars += block.command.length;
    }
    if (typeof block.code === 'string') toolChars += block.code.length;
  }
  return { parts: TYPE_ORDER.filter((p) => seen.has(p)), toolCalls, toolChars };
}
