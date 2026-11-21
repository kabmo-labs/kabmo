/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The app half: one contribution.
 *
 * - **`rightPanel`** is the view — the run list, the run's jobs and steps, a job's
 *   log, and the three verbs.
 *
 * There is no `headerPanel` and no content script. A navbar readout would have to
 * keep a poll alive for a number nobody is looking at, and this panel is the only
 * consumer of what it would print: the list refreshes when it opens, when the
 * scope or filter moves, and on Refresh.
 */

import { definePluginApp } from '@kabmo-labs/kabmo-sdk/app';

import { ActionsPanel } from './panel';

export default definePluginApp((app) => {
  app.rightPanel({
    id: 'runs',
    title: 'Runs',
    component: ActionsPanel,
    // A run row carries a state mark, a workflow name, a run number, a commit
    // subject and a branch/event/actor line; below this the subject is a
    // fragment.
    minWidth: 420,
  });
});
