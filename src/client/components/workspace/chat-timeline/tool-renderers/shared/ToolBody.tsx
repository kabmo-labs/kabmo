/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The expanded body of a tool call — one implementation for every render style.
 *
 * The card owned this markup inline. With four styles the body is the ONE part
 * that must not be duplicated: a `bash` panel drawn twice is two places to fix
 * when the panel changes, and the two would drift. The styles differ in their
 * frame, their density and their grouping; what a call SHOWS when opened is the
 * same everywhere.
 *
 * Three shapes, in priority order:
 *
 * 1. A plugin's own renderer, when the host has no panel for the tool (the
 *    slot's contract — a plugin must not shadow `bash` or `read`).
 * 2. The host's specialized panel (`ToolDetailsPanel`).
 * 3. The generic Input / Diff / Output, for a tool with no panel at all.
 */

import type { ReactNode } from 'preact/compat';
import { PluginIdProvider } from '@kabmo-labs/kabmo-ui';
import type { ToolCallData } from '@/shared/types';
import { CopyButton } from '@/client/components/common/CopyButton';
import { ToolDetailsPanel } from '@/client/components/workspace/chat-timeline/tool-renderers';
import { DiffView } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/DiffView';
import { FallbackOutput } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/FallbackOutput';
import { JsonCodeBlock } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/JsonCodeBlock';
import type { ToolView } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/tool-view';
import { usePluginSlotContext } from '@/client/hooks/workspace/list-slots';

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink/40">
      {children}
    </div>
  );
}

export function ToolBody({ tool, view }: { tool: ToolCallData; view: ToolView }): ReactNode {
  const slotContext = usePluginSlotContext();

  return (
    <>
      {view.pluginPanel ? (
        <PluginIdProvider pluginId={view.pluginPanel.pluginId}>
          <view.pluginPanel.registration.component
            {...slotContext}
            toolName={view.toolKey}
            args={tool.input}
            output={view.outputText}
          />
        </PluginIdProvider>
      ) : (
        <ToolDetailsPanel tool={tool} />
      )}

      {!view.hasBody && view.commandOrInput && (
        <div className="space-y-1.5 code-surface">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <SectionLabel>Input</SectionLabel>
              {view.inputJson?.isValid && (
                <span className="rounded bg-ink/5 px-1.5 py-0.2 font-mono text-[9px] uppercase tracking-wider text-ink/45">
                  JSON
                </span>
              )}
            </div>
            <CopyButton
              text={view.inputJson?.isValid && view.inputJson.pretty ? view.inputJson.pretty : view.commandOrInput}
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-ink/45 transition-colors hover:bg-ink/5 hover:text-ink"
              onClick={(e) => e.stopPropagation()}
              label="Copy"
            />
          </div>
          {view.inputJson?.isValid && view.inputJson.pretty ? (
            <JsonCodeBlock jsonString={view.inputJson.pretty} maxHeightClass="max-h-60" showHeader={false} />
          ) : (
            <pre className="overflow-x-auto rounded-lg border border-ink/8 bg-paper px-3 py-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all text-ink/80 select-text">
              {view.commandOrInput}
            </pre>
          )}
        </div>
      )}

      {!view.hasBody && view.diffText && (
        <div className="space-y-1.5">
          <SectionLabel>Diff</SectionLabel>
          <DiffView text={view.diffText} path={view.subtitle} />
        </div>
      )}

      {!view.hasBody && view.outputText && <FallbackOutput text={view.outputText} />}
    </>
  );
}
