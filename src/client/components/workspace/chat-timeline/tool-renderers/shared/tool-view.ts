/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Everything a tool call's row SAYS, derived once per call and shared by every
 * render style.
 *
 * The card used to own this derivation inline. When the transcript gained
 * alternative styles (`compact`, `trace`, `minimal`) each one would have needed
 * the same header, the same facts, the same fallback text — four copies of one
 * fact, which is exactly how a card and a rail start disagreeing about what a
 * call did. The derivation is a hook (it consults the plugin slot registry) but
 * it holds no state: `useMemo` keys on the tool, and the result is plain data
 * plus a VNode for the icon.
 *
 * Nothing here decides layout. `tool-renderers/styles/*` do that.
 */

import { useMemo } from 'preact/hooks';
import type { ReactNode } from 'preact/compat';
import type { ToolCallData } from '@/shared/types';
import { stripAnsiCodes } from '@/shared/lib/code/ansi';
import { isReminderTag, unwrapXmlEnvelopes } from '@/shared/lib/chat/xml-envelope';
import { toolSummary, type ToolSummary } from '@/shared/lib/chat/tool/summary';
import { tryParseJson, type JsonDetectionResult } from '@/shared/lib/code/syntax-highlight';
import { resolveToolKey } from '@/client/components/workspace/chat-timeline/tool-renderers';
import { usePluginTimelineRenderer, type PluginTimelineRenderer } from '@/client/components/workspace/chat-timeline/tool-renderers/plugin-renderers';
import { toolPanelKind } from '@/client/components/workspace/chat-timeline/tool-renderers/registry';
import {
  commandOrInputOf,
  diffTextOf,
  evalLanguageIcon,
  toolIcon,
} from '@/client/components/workspace/chat-timeline/tool-renderers/shared/card-helpers';
import {
  toolCardHeader,
  toolCardSubtitle,
  type ToolCardHeader,
} from '@/client/components/workspace/chat-timeline/tool-renderers/shared/card-header';

export interface ToolView {
  /** Canonical tool key — icon, panel and header all derive from it. */
  toolKey: string;
  /** A host panel exists for this tool; the generic Input/Diff/Output is skipped. */
  hasPanel: boolean;
  /** The plugin renderer to use INSTEAD, when the host has no panel. */
  pluginPanel: PluginTimelineRenderer;
  /** Whether there is anything to expand. */
  hasBody: boolean;
  summary: ToolSummary | null;
  header: ToolCardHeader;
  subtitle: string | undefined;
  icon: ReactNode;
  outputText: string;
  diffText: string | undefined;
  commandOrInput: string;
  inputJson: JsonDetectionResult | null;
  /** The result carried a runtime reminder envelope, not an outcome. */
  isReminder: boolean;
  /** Panels that are never collapsible (`ask`, `goal`, `yield`). */
  alwaysExpanded: boolean;
}

/** Panels whose whole point is a decision the reader is in the middle of. */
const ALWAYS_EXPANDED_KEYS: Record<string, true> = { yield: true, goal: true, ask: true };

export function useToolView(tool: ToolCallData): ToolView {
  const toolKey = resolveToolKey(tool);
  // A pure classification, not a probe render: the old `hasToolDetailsPanel`
  // built the panel's VNode and threw it away, once per card per streaming
  // frame. `toolPanelKind` is a lookup, so this is free.
  const hasPanel = useMemo(() => toolPanelKind(tool) !== null, [tool]);
  // A plugin renderer is consulted only for a tool the host has NO panel for,
  // so a plugin can ship its own agent tool without shadowing `bash` or `read`.
  const pluginRenderer = usePluginTimelineRenderer(toolKey);
  const pluginPanel = hasPanel ? null : pluginRenderer;
  const hasBody = hasPanel || pluginPanel !== null;
  const summary = useMemo(() => toolSummary(tool), [tool]);
  const header = useMemo(() => toolCardHeader(tool, toolKey), [tool, toolKey]);
  const subtitle = toolCardSubtitle(tool, header);

  const commandOrInput = commandOrInputOf(tool);
  const outputText = tool.output || (tool.error ? `Error: ${tool.error}` : '');
  const diffText = diffTextOf(tool);

  const inputJson = useMemo(
    () => (!hasBody && commandOrInput ? tryParseJson(commandOrInput) : null),
    [hasBody, commandOrInput],
  );

  // A reminder envelope in the result is the runtime interrupting the call, not
  // its outcome — the row flags it beside the status.
  const isReminder = useMemo(
    () => unwrapXmlEnvelopes(stripAnsiCodes(outputText)).some((envelope) => isReminderTag(envelope.tag)),
    [outputText],
  );

  // The intent chip is deliberately NOT part of this row. It used to be the
  // first chip, which pushed a real fact out: an `edit` showed
  // `Preferring dt.files for real files · +43 −16 · +1`, so `line 25` — the
  // thing the reader wants — sat behind the overflow counter. The row is
  // `path + facts` now, and the intent stays where it always was for every tool
  // except eval: nowhere, or inside the body's own panel.
  //
  // eval is the exception and shows its intent as the TITLE (`input.title` is
  // omp's label for the cell), so it carries no facts row at all — a second
  // line of `js · 1 cell · browser.open` under a title that already names the
  // action is the duplication this removes.
  const headerSummary = toolKey === 'eval' ? null : summary;

  // The eval card is marked by the language it runs, not a generic code glyph.
  const icon = tool.icon || (toolKey === 'eval' ? evalLanguageIcon(tool) : null) || toolIcon(toolKey);

  return {
    toolKey,
    hasPanel,
    pluginPanel,
    hasBody,
    summary: headerSummary,
    header,
    subtitle,
    icon,
    outputText,
    diffText,
    commandOrInput,
    inputJson,
    isReminder,
    alwaysExpanded: hasPanel && Boolean(ALWAYS_EXPANDED_KEYS[toolKey]),
  };
}
