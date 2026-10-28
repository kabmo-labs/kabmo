/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import type { PluginItem } from '@/shared/types';

/**
 * The identity of ONE installed plugin: its id AND its scope.
 *
 * A plugin id alone is ambiguous. The same `name@marketplace` installs into both
 * registries at once — omp lists the user copy with `shadowedBy: "project"` when
 * an enabled project copy overrides it — and the two differ in version,
 * enablement, install path and shadowing. Selecting by id made them one row, so
 * the pane could render the user copy and act on the project one.
 */
export function pluginSelectionKey(plugin: PluginItem): string {
  return `${plugin.id}::${plugin.scope}`;
}
