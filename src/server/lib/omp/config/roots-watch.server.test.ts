/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The discovery watcher's decisions: which directories it holds a watcher for,
 * and when it reports a change.
 *
 * The reload itself is `reloadLiveSessions` (covered separately). What these
 * tests pin is that a filesystem change under a watched root reaches the
 * callback — the behaviour a hand-written SKILL.md needs and a Kabmo-only
 * write path cannot provide — plus the three reconcile rules: a root that does
 * not exist yet is bridged, a root added later is picked up, and re-syncing
 * never doubles a watcher.
 *
 * The root list and the callback are injected, so no real `~/.omp`, workspace,
 * or module registry is touched.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createDiscoveryRootsWatch,
  type DiscoveryWatch,
} from '@/server/lib/omp/config/roots-watch.server';

const tempDirs: string[] = [];
let watch: DiscoveryWatch | null = null;
let roots: string[] = [];
let changes = 0;

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'omp-roots-watch-'));
  tempDirs.push(dir);
  return dir;
}

/**
 * Run `action` until the callback lands, re-issuing it every ~400 ms.
 *
 * Real time is unavoidable here: the signal under test is a NATIVE `fs.watch`
 * event, which no fake clock can produce, and the module's debounce is what
 * coalesces a burst. The retry is what makes the test deterministic — a
 * recursive `fs.watch` is registered asynchronously, so under a loaded suite a
 * single write can land before the OS starts reporting for that directory and
 * be lost, which is a property of the test's timing rather than of the module.
 * 400 ms exceeds the module's 250 ms debounce, so a re-issue can never keep
 * resetting the timer and starve the callback.
 */
async function settleAfter(action: () => Promise<void>, expected = 1, timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  do {
    await action();
    const quiet = Date.now() + 400;
    while (changes < expected && Date.now() < quiet) await Bun.sleep(20);
  } while (changes < expected && Date.now() < deadline);
}

/** Wait out a bounded window without acting — for a NEGATIVE assertion, where
 *  the absence of a callback is the thing being checked. */
async function settleQuiet(timeoutMs = 600): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) await Bun.sleep(25);
}

afterEach(async () => {
  watch?.stop();
  watch = null;
  roots = [];
  changes = 0;
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

function start(): DiscoveryWatch {
  watch = createDiscoveryRootsWatch({
    roots: async () => roots,
    onReload: () => {
      changes += 1;
    },
  });
  return watch;
}

describe('discovery roots watch', () => {
  test('a file written under a watched root reports one change', async () => {
    const root = join(await tempDir(), 'skills');
    await mkdir(root, { recursive: true });
    roots = [root];
    const watcher = start();

    await watcher.sync();
    await settleAfter(() => writeFile(join(root, 'new.md'), 'x'));

    // One callback for the burst, not one per filesystem event.
    expect(changes).toBe(1);
  });

  test('a nested directory created under a watched root is reported', async () => {
    const root = join(await tempDir(), 'skills');
    await mkdir(root, { recursive: true });
    roots = [root];
    const watcher = start();

    await watcher.sync();
    // The real shape: <root>/<name>/SKILL.md, written in two steps.
    await settleAfter(async () => {
      await mkdir(join(root, 'my-skill'), { recursive: true });
      await writeFile(join(root, 'my-skill', 'SKILL.md'), 'x');
    });

    expect(changes).toBe(1);
  });

  test('a root that does not exist yet is bridged through its ancestor', async () => {
    const workspace = await tempDir();
    const root = join(workspace, '.omp', 'skills');
    roots = [root];
    const watcher = start();

    // `.omp/skills` is absent at sync time — Kabmo must not create it.
    await watcher.sync();
    expect(await Bun.file(root).exists()).toBe(false);

    await settleAfter(async () => {
      await mkdir(root, { recursive: true });
      await writeFile(join(root, 'first.md'), 'x');
    });

    expect(changes).toBeGreaterThanOrEqual(1);
  });

  test('unrelated activity in a BRIDGE directory reports nothing', async () => {
    const workspace = await tempDir();
    // The stand-in is the workspace itself — a directory an editor, a build or a
    // chat session writes to constantly — because `.omp/skills` does not exist.
    roots = [join(workspace, '.omp', 'skills')];
    const watcher = start();
    await watcher.sync();

    await writeFile(join(workspace, 'README.md'), 'x');
    await mkdir(join(workspace, 'src'), { recursive: true });
    await writeFile(join(workspace, 'src', 'index.ts'), 'x');
    await settleQuiet(800);

    // A reload here would broadcast `/reload-plugins` for every file an editor,
    // a build or a `git checkout` touches — measured at 170 broadcasts in 20 s
    // on an idle machine before this was separated.
    expect(changes).toBe(0);
  });

  test('the root APPEARING is reported even though only a bridge saw it', async () => {
    const workspace = await tempDir();
    const root = join(workspace, '.omp', 'skills');
    roots = [root];
    const watcher = start();
    await watcher.sync();

    // Only the creation of the root itself — no file inside it yet. The bridge
    // watcher is what sees it, and the reconcile is what turns it into a reload.
    await settleAfter(async () => {
      await mkdir(root, { recursive: true });
    });

    expect(changes).toBeGreaterThanOrEqual(1);
  });

  test('a root added after the first sync is watched', async () => {
    const first = join(await tempDir(), 'skills');
    const second = join(await tempDir(), 'skills');
    await mkdir(first, { recursive: true });
    await mkdir(second, { recursive: true });
    roots = [first];
    const watcher = start();
    await watcher.sync();

    // A workspace created mid-session re-syncs with the new root.
    roots = [first, second];
    await watcher.sync();
    await settleAfter(() => writeFile(join(second, 'late.md'), 'x'));

    expect(changes).toBe(1);
  });

  test('re-syncing does not double the watchers', async () => {
    const root = join(await tempDir(), 'skills');
    await mkdir(root, { recursive: true });
    roots = [root];
    const watcher = start();

    await watcher.sync();
    await watcher.sync();
    await watcher.sync();
    await settleAfter(() => writeFile(join(root, 'once.md'), 'x'));

    // A duplicated watcher would report two changes for one write.
    expect(changes).toBe(1);
  });

  test('a root dropped from the list stops being watched', async () => {
    const root = join(await tempDir(), 'skills');
    await mkdir(root, { recursive: true });
    roots = [root];
    const watcher = start();
    await watcher.sync();

    roots = [];
    await watcher.sync();
    await writeFile(join(root, 'after-drop.md'), 'x');
    await settleQuiet();

    expect(changes).toBe(0);
  });
});
