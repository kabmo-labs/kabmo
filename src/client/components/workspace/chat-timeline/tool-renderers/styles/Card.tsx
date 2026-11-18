/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `card` style — the bordered, collapsible card Kabmo has always shipped.
 *
 * This file is the wiring only: `useToolView` derives what the card says, the
 * shared `ToolBody` draws what it shows, and `ToolCardShell` owns the frame and
 * the collapse state. The naming rules live in `card-header.ts`, the outcome
 * chips in `toolSummary`.
 */

import { useCallback } from 'preact/hooks';
import { memo } from 'preact/compat';
import { ToolBody } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/ToolBody';
import { ToolCardShell } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/ToolCardShell';
import { ToolRowActions } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/ToolRowActions';
import { useToolView } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/tool-view';
import type { ToolRowProps } from '@/client/components/workspace/chat-timeline/tool-renderers/styles/props';

export const CardRow = memo(function CardRow({ tool, isOpen, onToggle, defaultExpanded = false }: ToolRowProps) {
  const view = useToolView(tool);

  const handleToggle = useCallback(() => {
    onToggle?.(tool.id);
  }, [onToggle, tool.id]);

  // A reminder envelope in the result is the runtime interrupting the call, not
  // its outcome — the header flags it beside the status badge.
  const actions = <ToolRowActions tool={tool} isReminder={view.isReminder} />;

  return (
    <ToolCardShell
      tool={tool}
      icon={view.icon}
      title={view.header.title}
      subtitle={view.subtitle}
      summary={view.summary}
      actions={actions}
      isOpen={isOpen}
      onToggle={onToggle ? handleToggle : undefined}
      defaultExpanded={defaultExpanded}
      alwaysExpanded={view.alwaysExpanded}
    >
      <ToolBody tool={tool} view={view} />
    </ToolCardShell>
  );
});
