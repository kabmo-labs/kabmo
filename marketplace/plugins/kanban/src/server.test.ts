/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The plugin's server half, driven through the SDK's own API object.
 *
 * What this pins is the ONE thing the store cannot: an agent's write is a FILE
 * EVENT, and the panel only learns about it because this half publishes a new
 * revision. The MCP child is a separate process, so nothing else in the plugin
 * could notice.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';

import type { KabmoPluginApi, PluginJson } from '@kabmo-labs/kabmo-sdk';

import plugin from './server';
import { addCard, createBoard, moveCard } from './store/ops';
import { cardFile } from './store/fs';
import type { BoardSignal } from './protocol';

let dataDir = '';
let published: BoardSignal[] = [];
let disposed: (() => void | Promise<void>)[] = [];

/** The smallest API that satisfies the members `plugin()` touches. */
function fakeApi(): KabmoPluginApi {
  return {
    pluginId: 'kanban',
    paths: { dataDir },
    log: { debug() {}, info() {}, warn() {}, error() {} },
    realtime: {
      seed(value: PluginJson) {
        published = [value as unknown as BoardSignal];
      },
      publish(value: PluginJson) {
        published.push(value as unknown as BoardSignal);
      },
      current: () => published[published.length - 1],
    },
    rpc: { register: () => () => {} },
    mcp: { register: () => undefined },
    onDispose(hook: () => void | Promise<void>) {
      disposed.push(hook);
    },
  } as unknown as KabmoPluginApi;
}

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-server-'));
  published = [];
  disposed = [];
});

afterEach(async () => {
  for (const hook of disposed) await hook();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('the board watcher', () => {
  test('an agent writing a card file publishes a new revision', async () => {
    await createBoard(dataDir);
    plugin(fakeApi());
    // Seeded at load, so a subscriber that arrives first has a value.
    expect(published).toHaveLength(1);
    expect(published[0]).toEqual({ revision: 0, at: expect.any(String) });

    const card = await addCard(dataDir, { title: 'Agent work' });
    await moveCard(dataDir, card.id, 'review');

    // `fs.watch` delivery is asynchronous, so the wait polls — but it must not
    // KEEP WRITING: the publish is debounced, and a write every 50 ms clears the
    // timer before it can fire (measured: the loop starved its own assertion).
    const deadline = Date.now() + 5_000;
    while (published.length < 2 && Date.now() < deadline) await Bun.sleep(25);
    expect(published.length).toBeGreaterThan(1);
    expect(published[published.length - 1]!.revision).toBeGreaterThan(0);
  }, 10_000);

  test('a burst of writes collapses into one publish', async () => {
    await createBoard(dataDir);
    plugin(fakeApi());
    const before = published.length;
    const card = await addCard(dataDir, { title: 'Burst' });
    for (const status of ['backlog', 'open', 'in_progress', 'review', 'test', 'done']) {
      await moveCard(dataDir, card.id, status);
    }
    await Bun.sleep(400);
    // Six writes in a few milliseconds must not be six frames.
    expect(published.length - before).toBeLessThan(3);
  }, 10_000);

  test('dispose closes the watcher: a later write publishes nothing', async () => {
    await createBoard(dataDir);
    plugin(fakeApi());
    for (const hook of disposed) await hook();
    const before = published.length;
    await addCard(dataDir, { title: 'After dispose' });
    await Bun.sleep(300);
    expect(published.length).toBe(before);
  }, 10_000);

  test('the board directory is created so a first run has somewhere to watch', () => {
    plugin(fakeApi());
    expect(fs.existsSync(path.join(dataDir, 'kanban', 'cards'))).toBe(true);
    expect(fs.existsSync(cardFile(dataDir, 'k-abcdef'))).toBe(false);
  });
});
