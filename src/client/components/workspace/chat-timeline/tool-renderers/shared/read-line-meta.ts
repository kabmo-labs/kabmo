import type { ToolCallData } from '@kabmo-labs/kabmo-chat/contracts/chat';

export interface LineMeta {
  startLine?: number;
  lineNumbers?: (number | string | null | undefined)[];
}

/**
 * Resolve the starting line number (and any explicit line-number gutter) that a
 * `read` tool result should render against. Pure derivation from the tool call
 * payload — the ordering of the heuristics below is load-bearing.
 */
export function extractLineMeta(
  tool?: ToolCallData,
  targetFilePath?: string,
  rawContent?: string
): LineMeta {
  const details = (tool?.details ?? {}) as Record<string, any>;
  const input = (tool?.input && typeof tool.input === 'object' ? tool.input : {}) as Record<string, any>;

  // 1. Explicit lineNumbers array in details or displayContent
  const displayContent = details.displayContent;
  if (displayContent && Array.isArray(displayContent.lineNumbers) && displayContent.lineNumbers.length > 0) {
    return {
      startLine: typeof displayContent.startLine === 'number' ? displayContent.startLine : undefined,
      lineNumbers: displayContent.lineNumbers,
    };
  }
  if (Array.isArray(details.lineNumbers) && details.lineNumbers.length > 0) {
    return {
      startLine: typeof details.startLine === 'number' ? details.startLine : undefined,
      lineNumbers: details.lineNumbers,
    };
  }

  // 2. Explicit startLine in displayContent or details
  if (typeof displayContent?.startLine === 'number' && displayContent.startLine > 0) {
    return { startLine: displayContent.startLine };
  }
  if (typeof details.startLine === 'number' && details.startLine > 0) {
    return { startLine: details.startLine };
  }
  if (typeof details.start_line === 'number' && details.start_line > 0) {
    return { startLine: details.start_line };
  }
  if (typeof details.offset === 'number' && details.offset > 0) {
    return { startLine: details.offset };
  }

  // 3. Truncation shownRange start
  const shownRangeStart =
    details.meta?.truncation?.shownRange?.start ??
    details.truncation?.shownRange?.start ??
    details.meta?.shownRange?.start ??
    details.shownRange?.start;
  if (typeof shownRangeStart === 'number' && shownRangeStart > 0) {
    return { startLine: shownRangeStart };
  }

  // 4. Input startLine / offset / from
  const inputStart = input.start_line ?? input.startLine ?? input.offset ?? input.StartLine ?? input.from;
  if (typeof inputStart === 'number' && inputStart > 0) {
    return { startLine: inputStart };
  }
  if (typeof inputStart === 'string' && /^\d+$/.test(inputStart.trim())) {
    const parsed = parseInt(inputStart.trim(), 10);
    if (parsed > 0) return { startLine: parsed };
  }

  // 5. Line range in target / input path / title: e.g. "app/types/chat.ts:55-100"
  const pathCandidates = [
    typeof input.path === 'string' ? input.path : '',
    tool?.target || '',
    tool?.title || '',
    targetFilePath || '',
  ];
  for (const candidate of pathCandidates) {
    const match = candidate.match(/:(\d+)(?:-\d+)?(?:\s|$)/);
    if (match) {
      const parsed = parseInt(match[1], 10);
      if (parsed > 0) return { startLine: parsed };
    }
  }

  // 6. Elision notice inside content: e.g. "[Showing lines 54-103 of 208...]"
  if (rawContent) {
    const match = rawContent.match(/\[(?:Showing\s+)?lines?\s+(\d+)(?:-\d+)?/i);
    if (match) {
      const parsed = parseInt(match[1], 10);
      if (parsed > 0) return { startLine: parsed };
    }
  }

  return {};
}
