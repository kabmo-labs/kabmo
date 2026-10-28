/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Forge's app half.
 *
 * One right-panel view and nothing else: no content script, no header readout.
 * A content script exists when a plugin has work to do while its panel is
 * unmounted (the command-runner's force-stop is the example); a forge read is
 * only worth doing while somebody is looking at it, and a header readout would
 * be a second surface deciding when to read.
 *
 * The title names the VIEW, and the activity bar renders `<title> — <plugin
 * name>`: `Issues & requests` beside `Forge` reads as one panel, where `Forge`
 * beside `Forge` would read as a duplicate.
 */

import { definePluginApp } from '@kabmo-labs/kabmo-sdk/app';

import { ForgePanel } from './panel';

export default definePluginApp((app) => {
  app.rightPanel({
    id: 'forge',
    title: 'Issues & requests',
    component: ForgePanel,
    // A row carries a state badge, a title, an id, an author, a count and up to
    // two labels; below this the title is a fragment.
    minWidth: 420,
  });
});
