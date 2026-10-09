/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
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

import type { ComposerActionRegistration, ComposerBannerRegistration } from '@ompchamber/plugin-sdk';
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
          <Component
            key={`${entry.pluginId}:${entry.registration.id}`}
            {...context}
            text={text}
            isSubmitting={isSubmitting}
          />
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
        return <Component key={`${entry.pluginId}:${entry.registration.id}`} {...context} />;
      })}
    </>
  );
}
