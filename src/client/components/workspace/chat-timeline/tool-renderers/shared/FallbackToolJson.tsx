/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The body a tool call shows when the SERVER could not classify it.
 *
 * The renderer family is decided once, at ingress (`shared/lib/chat/tool/
 * render-key.ts`); a call whose producer sent no usable identity arrives with
 * `render.normalized === false`. Guessing a panel from the name here is exactly
 * what made one logical shell call draw a Bash card on one harness and a bare
 * Input/Output block on another — so an unclassified call is shown AS DATA:
 * its raw name, its arguments and its result, with no interpretation.
 *
 * The block is collapsible and capped like every other panel body: an
 * unclassified call can carry a megabyte of output, and the timeline must not
 * become a scroll of raw JSON because an adapter was terse.
 */

import { useMemo } from 'preact/hooks';
import type { ReactNode } from 'preact/compat';
import type { ToolCallData } from '@kabmo-labs/kabmo-chat-contracts/chat';
import { tryParseJson } from '@/shared/lib/code/syntax-highlight';
import { JsonCodeBlock } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/JsonCodeBlock';
import { CopyButton } from '@/client/components/common/CopyButton';

/** Lines of a raw result the fallback prints before it stops. */
const MAX_FALLBACK_CHARS = 20_000;

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/40">
      {children}
    </div>
  );
}

/** The facts a call reported, as one JSON document. */
function callDocument(tool: ToolCallData): string {
  const document: Record<string, unknown> = {
    id: tool.id,
    name: tool.name ?? tool.type,
    ...(tool.title && tool.title !== tool.name ? { title: tool.title } : {}),
    status: tool.status ?? 'unknown',
    ...(tool.input !== undefined ? { input: tool.input } : {}),
    ...(tool.output !== undefined ? { output: tool.output } : {}),
    ...(tool.error !== undefined ? { error: tool.error } : {}),
    ...(tool.details !== undefined ? { details: tool.details } : {}),
  };
  return JSON.stringify(document, null, 2);
}

export function FallbackToolJson({ tool }: { tool: ToolCallData }): ReactNode {
  const text = useMemo(() => callDocument(tool), [tool]);
  const clipped = text.length > MAX_FALLBACK_CHARS
    ? `${text.slice(0, MAX_FALLBACK_CHARS)}\n…[truncated ${text.length - MAX_FALLBACK_CHARS} chars]`
    : text;
  // A result that is itself JSON is printed as JSON; anything else (a log, a
  // patch) stays a code block so its whitespace survives.
  const parsed = useMemo(() => tryParseJson(clipped), [clipped]);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <SectionLabel>Unclassified call</SectionLabel>
        <CopyButton
          text={clipped}
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-ink/45 transition-colors hover:bg-ink/5 hover:text-ink"
          label="Copy"
        />
      </div>
      <p className="text-[11px] leading-relaxed text-ink/50">
        The agent reported <code className="font-mono">{tool.name ?? tool.type}</code> without a
        renderer Kabmo knows, so the call is shown as raw data.
      </p>
      {parsed.isValid && parsed.pretty ? (
        <JsonCodeBlock jsonString={parsed.pretty} maxHeightClass="max-h-96" showHeader={false} />
      ) : (
        <pre className="max-h-96 overflow-auto rounded-lg border border-ink/8 bg-paper px-3 py-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all text-ink/80 select-text">
          {clipped}
        </pre>
      )}
    </div>
  );
}
