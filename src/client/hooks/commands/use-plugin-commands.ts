/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Plugin-contributed commands, bridged into the host registry.
 *
 * The SDK slot is a list of registrations; the host needs an implementation
 * per id and a `CommandMeta` per row. Both are derived here, and the whole set
 * is replaced whenever the slot changes — a plugin that unloads must take its
 * commands with it, or the palette would offer a row that throws.
 */

import { useEffect } from 'preact/hooks';
import type { CommandRegistration } from '@kabmo-labs/kabmo-sdk';
import { parseChord } from '@/shared/lib/commands/chord';
import type { CommandMeta, DefaultKey } from '@/shared/lib/commands/types';
import { registerCommand } from '@/client/lib/commands/registry';
import { setPluginCommands } from '@/client/lib/commands/keymap';
import { pluginContext } from '@/client/lib/plugins/context';
import { useListSlotRows } from '@/client/hooks/workspace/list-slots';

function defaultKeyOf(registration: CommandRegistration): DefaultKey | undefined {
  const key = registration.defaultKey;
  if (!key) return undefined;
  try {
    return { mac: parseChord(key.mac), other: parseChord(key.other) };
  } catch {
    // A malformed default is a plugin bug, and binding it to something else
    // would be worse than leaving the command unbound. The settings table still
    // lists the command, so the user can assign a chord themselves.
    return undefined;
  }
}

export function usePluginCommands(): void {
  const rows = useListSlotRows<CommandRegistration>('command');

  useEffect(() => {
    const metas: CommandMeta[] = [];
    const disposers: (() => void)[] = [];

    for (const { pluginId, registration } of rows) {
      const id = `plugin.${pluginId}.${registration.id}`;
      const defaultKey = defaultKeyOf(registration);
      metas.push({
        id,
        title: registration.title,
        category: 'Plugin',
        ...(registration.when ? { when: registration.when } : {}),
        ...(defaultKey ? { defaultKey } : {}),
        source: 'plugin',
        pluginId,
      });
      disposers.push(
        registerCommand(id, (args) =>
          registration.run({ ...pluginContext(), args: typeof args === 'string' ? args : '' }),
        ),
      );
    }

    setPluginCommands(metas);
    return () => {
      for (const dispose of disposers) dispose();
      setPluginCommands([]);
    };
  }, [rows]);
}
