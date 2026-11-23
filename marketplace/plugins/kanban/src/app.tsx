/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Kanban's app half: one contribution, and one guard.
 *
 * The `rightPanel` registration is the whole visible surface — a board, a card
 * sheet and a stages sheet all live inside it. There is deliberately no navbar
 * readout and no content script: a count in the top bar would cost a background
 * read for a number the panel already draws, and nothing has to run while the
 * panel is closed (the server half owns the watcher, and the MCP child owns an
 * agent's writes).
 *
 * The MCP server is NOT here: it lives in `server.ts`, because `dist/server.js`
 * is the only bundle built for Bun and spawned as a process. This bundle runs in
 * a browser, where there is no stdio to serve.
 */

import { definePluginApp } from '@kabmo-labs/kabmo-sdk/app';

import { KanbanPanel } from './panel/index';

export default definePluginApp((app) => {
  app.rightPanel({
    id: 'board',
    title: 'Kanban',
    component: KanbanPanel,
    // A lane is 200 px and a card needs ~180 of it; below this the board is one
    // lane and a scrollbar, which is what the phone gets anyway.
    minWidth: 420,
  });
});
