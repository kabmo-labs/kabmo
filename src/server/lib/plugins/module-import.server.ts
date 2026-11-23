/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Importing a plugin's server bundle as a module Bun has not seen.
 *
 * A plain `import(entry)` is cached by resolved URL, and **Bun ignores a query
 * string on a file specifier** (measured in one process: `?v=1` then `?v=2`
 * returned the SAME module object). So a rebuilt plugin kept running its previous
 * code until Kabmo restarted, and Rebuild looked like a no-op.
 *
 * The workaround is a COPY in the same directory, imported under its own name: a
 * fresh URL, and `import.meta.url` still resolves to a real file in the plugin's
 * own directory — which matters, because a plugin that ships an MCP server spawns
 * itself from that URL. The copy is removed on dispose, never immediately: an
 * unlinked path would make that spawn fail.
 */

import fs from 'fs';
import { basename, dirname, join } from 'path';
import { pathToFileURL } from 'node:url';

/** Never reused: each load is a fresh module, so a Rebuild always takes effect. */
let moduleLoadSeq = 0;

export async function importPluginModule(entry: string): Promise<{
  module: unknown;
  cleanup: () => Promise<void>;
}> {
  // A dot prefix keeps the copy out of the bundle route and out of a directory
  // listing a reader would mistake for a real entry.
  const copy = join(dirname(entry), `.${basename(entry)}.load-${++moduleLoadSeq}.mjs`);
  await fs.promises.copyFile(entry, copy);
  try {
    return {
      module: await import(pathToFileURL(copy).href),
      cleanup: () => fs.promises.rm(copy, { force: true }),
    };
  } catch (cause) {
    await fs.promises.rm(copy, { force: true });
    throw cause;
  }
}
