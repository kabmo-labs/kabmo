/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The composer's two list slots: `composerAction` (a button in the toolbar) and
 * `composerBanner` (a strip above the input).
 *
 * Both return `null` for an empty slot, so a composer with no plugins renders
 * exactly the row it did before — no spacer, no empty group, no wrapper. The
 * banner strip is the same position `GoalSurfaces` occupies, which is what
 * "above the input" means here: between the attachment row and the textarea.
 */

import type { ComposerActionRegistration, ComposerBannerRegistration } from '@kabmo-labs/kabmo-sdk';
import { PluginIdProvider } from '@kabmo-labs/kabmo-ui';
import { useListSlotRows, usePluginSlotContext } from '@/client/hooks/workspace/list-slots';

interface PluginComposerActionsProps {
  /** The draft as it stands, read at render time. */
  text: string;
  /** Whether a run is in flight, so a send-like action can disable itself. */
  isSubmitting: boolean;
}

export function PluginComposerActions({ text, isSubmitting }: PluginComposerActionsProps) {
  const rows = useListSlotRows<ComposerActionRegistration>('composerAction');
  const context = usePluginSlotContext();
  if (rows.length === 0) return null;
  return (
    <>
      {rows.map((entry) => {
        const Component = entry.registration.component;
        return (
          <PluginIdProvider key={`${entry.pluginId}:${entry.registration.id}`} pluginId={entry.pluginId}>
            <Component {...context} text={text} isSubmitting={isSubmitting} />
          </PluginIdProvider>
        );
      })}
    </>
  );
}

export function PluginComposerBanners() {
  const rows = useListSlotRows<ComposerBannerRegistration>('composerBanner');
  const context = usePluginSlotContext();
  if (rows.length === 0) return null;
  return (
    <>
      {rows.map((entry) => {
        const Component = entry.registration.component;
        return (
          <PluginIdProvider key={`${entry.pluginId}:${entry.registration.id}`} pluginId={entry.pluginId}>
            <Component {...context} />
          </PluginIdProvider>
        );
      })}
    </>
  );
}
