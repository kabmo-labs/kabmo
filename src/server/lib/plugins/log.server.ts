/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A plugin's logger, prefixed with its own id.
 *
 * The prefix is the whole feature: a plugin's `info('connected')` on its own
 * would be indistinguishable from Kabmo's own logging, and the first
 * question about any log line is whose it is. It goes through `console` rather
 * than a logging library because that is what the rest of this server does —
 * a plugin does not get a second output path.
 *
 * `detail` is serialized defensively: a plugin handing over a value with a
 * circular reference must produce a log line, not an exception inside the
 * logger.
 */

import type { PluginJson, PluginLogger } from '@kabmo-labs/kabmo-sdk';

function describe(detail: PluginJson | undefined): string {
  if (detail === undefined) return '';
  try {
    return ` ${JSON.stringify(detail)}`;
  } catch {
    return ' [detail could not be serialized]';
  }
}

/** The logger one plugin is handed at load. */
export function createPluginLogger(pluginId: string): PluginLogger {
  const prefix = `[plugin:${pluginId}]`;
  return {
    debug: (message, detail) => console.debug(`${prefix} ${message}${describe(detail)}`),
    info: (message, detail) => console.log(`${prefix} ${message}${describe(detail)}`),
    warn: (message, detail) => console.warn(`${prefix} ${message}${describe(detail)}`),
    error: (message, detail) => console.error(`${prefix} ${message}${describe(detail)}`),
  };
}
