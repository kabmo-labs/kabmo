/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The plugin's server half: the RPC surface the panel calls, the invalidation
 * topic, and the watcher that notices an AGENT's write.
 *
 * The watcher is the half that makes decision 3 visible. An agent moves a card
 * through the MCP child, which is a different process; the panel only learns
 * about it because `cards/` changed and this half publishes a new revision. So
 * the topic carries `{ revision, at }` rather than the board — a 500-card board
 * on every file event would be the socket doing a database's job.
 *
 * Nothing here resolves a model or spawns a session. `resolveAgent` reports the
 * chain and the PANEL calls `/api/agent/new` with it, because that route already
 * owns the fallbacks (project default, persisted pick, approval mode) and a
 * second copy of that rule is how the board and the composer would drift.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

import type { KabmoPluginApi } from '@kabmo-labs/kabmo-sdk';

import type { BoardSignal, ResolvedAgent } from './protocol';
import { KanbanError, boardDir, cardsDir } from './store/fs';
import {
  addCard,
  cardDetail,
  claimCard,
  createBoard,
  linkSession,
  moveCard,
  readBoardState,
  removeCard,
  saveDefaults,
  saveStages,
  updateCard,
} from './store/ops';
import { readBoard } from './store/board';
import { resolveAgent } from './store/resolve';
import { runMcpServer } from './mcp';

/** The debounce a burst of file events collapses into. */
const WATCH_DEBOUNCE_MS = 150;

/**
 * The MCP bootstrap lives HERE, not in the app bundle.
 *
 * `dist/server.js` is the one file built for Bun and spawned as a process, so it
 * is the only place a stdio server can live. `import.meta.main` is what keeps the
 * two uses apart: Kabmo IMPORTS this module as a factory, and an MCP client RUNS
 * it with `--mcp` — without the guard, importing the plugin would start a server
 * on Kabmo's own stdin.
 */
if (import.meta.main && Bun.argv.includes('--mcp')) {
  // The HOST's data dir, not the board dir: `boardDir()` appends `kanban`, and
  // handing it a board dir would nest a second one.
  const dir = Bun.env.KANBAN_DATA_DIR;
  if (!dir) {
    // Loud, because an empty board is worse than a refusal: a client pointed at
    // the wrong directory would read cards that are not there and act on them.
    process.stderr.write('kanban: KANBAN_DATA_DIR is required when running as an MCP server.\n');
    process.exit(2);
  }
  await runMcpServer(dir);
}

export default function plugin(api: KabmoPluginApi): void {
  const dataDir = api.paths.dataDir;
  let revision = 0;
  api.realtime.seed({ revision: 0, at: new Date().toISOString() } satisfies BoardSignal);

  const publish = () => {
    revision += 1;
    api.realtime.publish({ revision, at: new Date().toISOString() } satisfies BoardSignal);
  };

  /** Run an operation, publish, and answer the fresh revision with it. */
  const mutate = async <T>(work: () => Promise<T>): Promise<T & { revision: number }> => {
    const value = await work();
    publish();
    return { ...value, revision: revision + 1 };
  };

  // `openBoard` answers absence as a VALUE (`exists: false`), because the panel
  // needs to offer Create — and the route re-wraps a thrown refusal as
  // `handler_error`, so a code the client matched on would never arrive.
  api.rpc.register('openBoard', { handler: () => readBoardState(dataDir) });
  api.rpc.register('initBoard', { handler: async () => ({ exists: true, ...(await createBoard(dataDir)) }) });
  api.rpc.register('readCard', {
    handler: async (input) => {
      const { id } = input as { id: string };
      const { card, board } = await cardDetail(dataDir, id);
      const stage = board.stages.find((entry) => entry.id === card.status);
      return { card, board, stage: stage ?? null, agent: resolveAgent(card, stage, board) };
    },
  });
  api.rpc.register('createCard', {
    handler: (input) => mutate(async () => ({ card: await addCard(dataDir, input as never) })),
  });
  api.rpc.register('updateCard', {
    handler: (input) => {
      const { id, patch, baseUpdatedAt } = input as { id: string; patch: never; baseUpdatedAt?: string };
      return mutate(async () => ({ card: await updateCard(dataDir, id, patch, baseUpdatedAt) }));
    },
  });
  api.rpc.register('moveCard', {
    handler: (input) => {
      const { id, status, baseUpdatedAt } = input as { id: string; status: string; baseUpdatedAt?: string };
      return mutate(async () => moveCard(dataDir, id, status, baseUpdatedAt));
    },
  });
  api.rpc.register('deleteCard', {
    handler: (input) => {
      const { id } = input as { id: string };
      return mutate(async () => {
        await removeCard(dataDir, id);
        return {};
      });
    },
  });
  api.rpc.register('linkSession', {
    handler: (input) => {
      const { id, sessionId } = input as { id: string; sessionId: string | null };
      return mutate(async () => ({ card: await linkSession(dataDir, id, sessionId) }));
    },
  });
  api.rpc.register('claimCard', {
    handler: (input) => {
      const { id, sessionId } = input as { id: string; sessionId?: string };
      return mutate(async () => ({ card: await claimCard(dataDir, id, sessionId) }));
    },
  });
  api.rpc.register('saveStages', {
    handler: (input) => {
      const { stages } = input as { stages: never };
      return mutate(async () => ({ board: (await saveStages(dataDir, stages)).board }));
    },
  });
  api.rpc.register('saveDefaults', {
    handler: (input) => {
      const { defaults } = input as { defaults: never };
      return mutate(async () => ({ board: (await saveDefaults(dataDir, defaults)).board }));
    },
  });
  /** The chain, reported so the sheet can name where every field came from. */
  api.rpc.register('resolveAgent', {
    handler: async (input) => {
      const { id } = input as { id: string };
      const { card, board } = await cardDetail(dataDir, id);
      const stage = board.stages.find((entry) => entry.id === card.status);
      return { agent: resolveAgent(card, stage, board) satisfies ResolvedAgent };
    },
  });
  /** The board's defaults and stages, for a sheet that has no card selected. */
  api.rpc.register('readStages', { handler: () => readBoard(dataDir) });
  api.rpc.register('watchTick', {
    // Exposed for the panel's manual Refresh: the same publish a file event does.
    handler: () => {
      publish();
      return { revision };
    },
  });
  /**
   * Watch the board directory.
   *
   * `fs.watch` on the directory (not each file) so a card CREATED by an agent is
   * noticed too. The watcher is best-effort: a platform that cannot watch leaves
   * the panel's Refresh button as the way to catch up, which is stated rather
   * than hidden.
   */
  let watcher: fs.FSWatcher | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      publish();
    }, WATCH_DEBOUNCE_MS);
  };
  try {
    fs.mkdirSync(cardsDir(dataDir), { recursive: true });
    watcher = fs.watch(cardsDir(dataDir), { persistent: false }, schedule);
  } catch (cause) {
    api.log.warn('the board is not being watched; Refresh still re-reads', {
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }

  api.onDispose(() => {
    clearTimeout(timer);
    watcher?.close();
    watcher = null;
  });

  /**
   * The agent's tool surface, declared once and delivered by the host.
   *
   * `env` is what makes this work with no `cwd` on a plugin MCP server: the child
   * is TOLD where Kabmo keeps its state instead of guessing from the agent's
   * directory.
   * `fileURLToPath`, not `.pathname`, because the latter yields `/C:/…` on
   * Windows. `--mcp` is the guard `server.ts` checks with `import.meta.main`, so
   * this file is both the plugin and the MCP server.
   */
  api.mcp.register({
    id: 'board',
    transport: 'stdio',
    command: Bun.which('bun') ?? 'bun',
    args: [fileURLToPath(import.meta.url), '--mcp'],
    env: { KANBAN_DATA_DIR: dataDir },
  });

  api.log.info('kanban server half loaded', { board: boardDir(dataDir) });
}

/** Re-exported so the RPC route can answer a refusal as a value, not a throw. */
export { KanbanError };

/** The card file path, for the panel's "Show file" action. */
export function cardPath(dataDir: string, id: string): string {
  return path.join(cardsDir(dataDir), `${id}.json`);
}
