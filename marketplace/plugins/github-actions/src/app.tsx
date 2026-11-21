/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The app half: two contributions, and each answers what the other cannot.
 *
 * - **`rightPanel`** is the view — the run list, the run's jobs and steps, a job's
 *   log, and the three verbs.
 * - **`headerPanel`** is the navbar readout — `3 failing` / `2 running` / `CI ok`
 *   — and it opens the panel (`opensPanel`). Without it the plugin would only
 *   report what a reader already suspected and opened the panel to check; with
 *   it, a red `main` is visible from any view. It is affordable because a
 *   conditional poll that answers `304` costs no API quota, and because the
 *   readout releases its watch while the document is hidden.
 *
 * No content script: unlike the command-runner's force-stop, nothing here has
 * work to do while no surface is mounted. The server's poller makes no request
 * when nobody is watching, which is the same answer with less machinery.
 */

import { definePluginApp } from '@kabmo-labs/kabmo-sdk/app';

import { ActionsReadout } from './header';
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

  app.headerPanel({
    id: 'ci',
    title: 'Actions',
    component: ActionsReadout,
    opensPanel: 'rightPanel',
  });
});
