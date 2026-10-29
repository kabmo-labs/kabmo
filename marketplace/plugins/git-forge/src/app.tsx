/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Forge's app half.
 *
 * Two contributions, and each answers a question the other cannot:
 *
 * - **`rightPanel`** is the view: the list, the item, the writes. It is the only
 *   surface — there is deliberately NO navbar readout: a count in the top bar
 *   costs a background read every few minutes for a number the panel already
 *   draws in its own sidebar the moment somebody opens it.
 * - **`commandPaletteAction`** is `/issue <n>`, which quotes an item into the
 *   composer. It is the one contribution that acts on the CONVERSATION, which is
 *   what makes the plugin useful for a repository nobody is reviewing.
 *
 * No content script: one exists when a plugin has work to do while its panel is
 * unmounted (the command-runner's force-stop is the example). A forge read is
 * only worth doing while somebody is looking at it.
 */

import { definePluginApp } from '@kabmo-labs/kabmo-sdk/app';
import { requireServices } from '@kabmo-labs/kabmo-ui';

import { ForgePanel } from './panel';
import { runIssueCommand } from './command';

export default definePluginApp((app) => {
  const pluginId = app.pluginId;

  app.rightPanel({
    id: 'forge',
    title: 'Issues & requests',
    component: ForgePanel,
    // A row carries a state badge, a title, an id, an author, a count and up to
    // two labels; below this the title is a fragment.
    minWidth: 420,
  });

  /**
   * `/issue <number>`.
   *
   * A command's `run` is not a component, so it reads the kit's SERVICES rather
   * than hooks — the same reason the command-runner's content script does. The
   * pure half lives in `command.ts`, which is what the tests drive.
   */
  app.commandPaletteAction({
    id: 'issue',
    command: 'issue',
    description: 'Quote an issue or pull request into the prompt',
    hint: '<number>',
    run: (context) => {
      const services = requireServices();
      // The SHARED repo pick, not the workspace root: a monorepo's repository is
      // a nested path, and reading the root would ask the wrong project's forge.
      const scope = services.repoScope?.();
      const target = scope?.root ? { root: scope.root, repo: scope.repo } : null;
      return runIssueCommand(context.args, {
        scope: target,
        call: async (method, input) =>
          services.callRpc
            ? await services.callRpc(pluginId, method, input)
            : { ok: false, error: { code: 'no_plugin', message: 'This component is not inside a plugin.' } },
        insert: (text) => services.composer?.().insert(text),
        report: (message) => services.composer?.().insert(`\n${message}\n`),
      });
    },
  });
});
