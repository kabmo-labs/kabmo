/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
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
  rmSync(join(agentDir, 'ompchamber-title-model.yml'), { force: true });
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

  test('concurrent overrides are serialized, so one cannot reset the other mid-flight', async () => {
    const { withTitleModelOverride, ensureTitleModelOverlay, titleModelOverlayPath } = await overlay();
    ensureTitleModelOverlay();
    const path = titleModelOverlayPath();
    const order: string[] = [];

    await Promise.all([
      withTitleModelOverride('first/model', async () => {
        expect(readFileSync(path, 'utf8')).toContain('first/model');
        order.push('first');
      }),
      withTitleModelOverride('second/model', async () => {
        // The first has already reset by the time this one runs.
        expect(readFileSync(path, 'utf8')).toContain('second/model');
        order.push('second');
      }),
    ]);

    expect(order).toEqual(['first', 'second']);
    expect(readFileSync(path, 'utf8')).toBe('{}\n');
  });
});
