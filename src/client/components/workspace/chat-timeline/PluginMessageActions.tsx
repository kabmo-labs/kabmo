/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `messageAction` list slot's host: the plugin buttons a chat row's action
 * strip renders beside Retry / Copy / New-chat.
 *
 * A row is drawn ONLY when a plugin contributed one — the component returns
 * `null` for an empty slot, so a Kabmo with no plugins produces exactly the
 * same tree it did before this slot existed. That is the property the whole
 * list-slot design rests on: the host surface does not gain a wrapper, a spacer
 * or an empty group when nothing registered.
 *
 * The props a plugin receives are the ROW's, read here rather than by each
 * surface: a footer, a mobile sheet and a user row all know the same three
 * facts (id, role, text), so they share one component instead of three.
 */

import type { MessageActionRegistration } from '@kabmo-labs/kabmo-sdk';
import type { ListSlotEntry } from '@/client/lib/plugins/list-slots';
import { PluginIdProvider } from '@kabmo-labs/kabmo-ui';
import { useListSlotRows, usePluginSlotContext } from '@/client/hooks/workspace/list-slots';

interface PluginMessageActionsProps {
  /** The row's id as the timeline holds it. */
  messageId: string;
  /** The row's role as the timeline spells it. */
  role: string;
  /** Every text block of the row, joined — what a Copy-like action takes. */
  text: string;
}

export function PluginMessageActions({ messageId, role, text }: PluginMessageActionsProps) {
  const rows = useListSlotRows<MessageActionRegistration>('messageAction');
  const context = usePluginSlotContext();
  if (rows.length === 0) return null;
  return (
    <>
      {rows.map((entry: ListSlotEntry<MessageActionRegistration>) => {
        const Component = entry.registration.component;
        return (
          <PluginIdProvider key={`${entry.pluginId}:${entry.registration.id}`} pluginId={entry.pluginId}>
            <Component {...context} messageId={messageId} role={role} text={text} />
          </PluginIdProvider>
        );
      })}
    </>
  );
}
