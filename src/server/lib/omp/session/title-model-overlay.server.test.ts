/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The title-model overlay's contract with omp.
 *
 * Every rule here was measured against a real child and each one is a hard
 * error in omp when broken:
 *
 *   - a missing or malformed `--config` file is a HARD failure in omp's strict
 *     overlay loader, so the file has to exist before the spawn reads the argv
 *     and must never be deleted while a child watches it;
 *   - the role has to be UNDER `modelRoles` — a top-level `tiny:` parses fine
 *     and changes nothing, so a rename would still use the user's dead role;
 *   - the override has to be removed when the request settles, or the next
 *     child spawned loads a pin to a session's model.
 *
 * The tests point the agent dir at a temp directory, so nothing here touches
 * the developer's own `~/.omp`.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let agentDir: string;
let previousAgentDir: string | undefined;

beforeAll(() => {
  agentDir = mkdtempSync(join(tmpdir(), 'omc-title-overlay-'));
  previousAgentDir = Bun.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
});

afterAll(() => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  rmSync(agentDir, { recursive: true, force: true });
});

afterEach(() => {
  rmSync(join(agentDir, 'kabmo-title-model.yml'), { force: true });
});

/** The module resolves the agent dir at import time, so it is imported after
 *  the env is in place. `await import` keeps that ordering explicit. */
const overlay = () => import('@/server/lib/omp/session/title-model-overlay.server');

describe('title-model overlay', () => {
  test('creates the file before a spawn names it, and never rewrites it', async () => {
    const { ensureTitleModelOverlay, titleModelOverlayPath } = await overlay();
    const path = titleModelOverlayPath();
    expect(existsSync(path)).toBe(false);

    ensureTitleModelOverlay();
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, 'utf8')).toBe('{}\n');

    // A second call must leave a rename's in-flight override alone.
    const withRole = `modelRoles:\n  tiny: "x/y"\n`;
    writeFileSync(path, withRole);
    ensureTitleModelOverlay();
    expect(readFileSync(path, 'utf8')).toBe(withRole);
  });

  test('creates a missing agent directory, not just the file', async () => {
    // The failure this pins: on a machine where omp was installed and never run
    // — a CI runner, a container, a fresh box — `~/.omp/agent` does not exist.
    // The bare write threw ENOENT, the catch swallowed it, and every spawn then
    // named a `--config` path omp answers with `Config overlay not found`: no
    // session at all, and no error naming the real cause.
    const { ensureTitleModelOverlay, titleModelOverlayPath } = await overlay();
    const nested = join(agentDir, 'not', 'yet', 'agent');
    const prior = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = nested;
    try {
      expect(existsSync(nested)).toBe(false);
      ensureTitleModelOverlay();
      expect(existsSync(join(nested, 'kabmo-title-model.yml'))).toBe(true);
    } finally {
      process.env.PI_CODING_AGENT_DIR = prior;
    }
    expect(titleModelOverlayPath()).toBe(join(agentDir, 'kabmo-title-model.yml'));
  });

  test('writes the role under `modelRoles` and restores the empty overlay after', async () => {
    const { withTitleModelOverride, ensureTitleModelOverlay, titleModelOverlayPath } = await overlay();
    ensureTitleModelOverlay();
    const path = titleModelOverlayPath();

    const result = await withTitleModelOverride('kenari-jatis/deepseek-v4-1-flash', async () => {
      // Inside the override the child would read this on its reload.
      expect(readFileSync(path, 'utf8')).toBe('modelRoles:\n  tiny: "kenari-jatis/deepseek-v4-1-flash"\n');
      return 'named';
    });

    expect(result).toBe('named');
    expect(readFileSync(path, 'utf8')).toBe('{}\n');
  });

  test('an unreadable model runs the request untouched', async () => {
    const { withTitleModelOverride, ensureTitleModelOverlay, titleModelOverlayPath } = await overlay();
    ensureTitleModelOverlay();
    const path = titleModelOverlayPath();

    const result = await withTitleModelOverride(undefined, async () => {
      expect(readFileSync(path, 'utf8')).toBe('{}\n');
      return 'untouched';
    });

    expect(result).toBe('untouched');
  });

  test('the override is removed even when the request throws', async () => {
    const { withTitleModelOverride, ensureTitleModelOverlay, titleModelOverlayPath } = await overlay();
    ensureTitleModelOverlay();
    const path = titleModelOverlayPath();

    await expect(
      withTitleModelOverride('a/b', async () => {
        throw new Error('child gone');
      }),
    ).rejects.toThrow('child gone');

    expect(readFileSync(path, 'utf8')).toBe('{}\n');
  });

  test('concurrent overrides are newest-wins, and the last holder releases the pin', async () => {
    // The overlay is ONE file for every session, and a title model can take a
    // minute — queueing a second request behind the first would make the
    // operator's next prompt wait on a generation it has nothing to do with.
    // So the most recent request owns the file, and the file is cleared only
    // when no request holds it.
    const { withTitleModelOverride, ensureTitleModelOverlay, titleModelOverlayPath } = await overlay();
    ensureTitleModelOverlay();
    const path = titleModelOverlayPath();
    const seen: string[] = [];
    const releaseFirst = Promise.withResolvers<void>();
    const firstHolds = Promise.withResolvers<void>();

    const first = withTitleModelOverride('first/model', async () => {
      expect(readFileSync(path, 'utf8')).toContain('first/model');
      seen.push('first');
      firstHolds.resolve();
      // Still generating when the second request arrives.
      await releaseFirst.promise;
    });
    await firstHolds.promise;

    const second = withTitleModelOverride('second/model', async () => {
      // The newer request owns the file even though the older one is running.
      expect(readFileSync(path, 'utf8')).toContain('second/model');
      seen.push('second');
    });
    await second;

    // The older holder leaving must NOT clear the newer pin.
    releaseFirst.resolve();
    await first;

    expect(seen).toEqual(['first', 'second']);
    expect(readFileSync(path, 'utf8')).toBe('{}\n');
  });
});
