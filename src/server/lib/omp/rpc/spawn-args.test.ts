/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The argv contract with the omp binary, pinned.
 *
 * Every value here is load-bearing in a way that is invisible at the call site:
 * the builders are the literal contract with omp (`--resume`, `--approval-mode`,
 * `-e`), and a silent change to the ORDER is a behavior change — the stage
 * prompt must ride before the extension load, and the overlay must exist by the
 * time the argv names it.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { titleModelOverlayPath } from '@/server/lib/omp/session/title-model-overlay.server';
import { buildSessionSpawnArgs, resolveSpawnCwd } from '@/server/lib/omp/rpc/spawn-args';
import { kabmoExtensionArgs } from '@kabmo-labs/kabmo-omp-extensions';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kabmo-spawn-args-'));
  tempDirs.push(dir);
  return dir;
}

describe('resolveSpawnCwd', () => {
  test('a recorded cwd that still exists is used verbatim', async () => {
    const dir = tempDir();
    expect(await resolveSpawnCwd(dir)).toBe(dir);
  });

  test('a deleted recorded cwd falls back to the server cwd', async () => {
    const dir = tempDir();
    rmSync(dir, { recursive: true, force: true });
    expect(await resolveSpawnCwd(dir)).toBe(process.cwd());
    expect(await resolveSpawnCwd(null)).toBe(process.cwd());
    expect(await resolveSpawnCwd(undefined)).toBe(process.cwd());
  });
});

describe('buildSessionSpawnArgs', () => {
  test('the title-model overlay, then the resume file, approval mode and extension load', () => {
    expect(buildSessionSpawnArgs('/tmp/session.jsonl', 'yolo')).toEqual([
      '--config',
      titleModelOverlayPath(),
      '--resume',
      '/tmp/session.jsonl',
      '--approval-mode',
      'yolo',
      ...kabmoExtensionArgs(),
    ]);
  });

  test('an approval mode is passed without a resume file', () => {
    expect(buildSessionSpawnArgs('', 'write')).toEqual([
      '--config',
      titleModelOverlayPath(),
      '--approval-mode',
      'write',
      ...kabmoExtensionArgs(),
    ]);
  });

  test('a new session still gets the overlay and the extension load', () => {
    expect(buildSessionSpawnArgs('')).toEqual(['--config', titleModelOverlayPath(), ...kabmoExtensionArgs()]);
  });

  test('a stage prompt is APPENDED, never substituted, and rides before the extension load', () => {
    // `--system-prompt` would replace omp's own coding prompt and with it the
    // tool contract; only `--append-system-prompt` keeps the agent usable.
    expect(buildSessionSpawnArgs('', 'write', undefined, { systemPrompt: 'Review the change.' })).toEqual([
      '--config',
      titleModelOverlayPath(),
      '--approval-mode',
      'write',
      '--append-system-prompt',
      'Review the change.',
      ...kabmoExtensionArgs(),
    ]);
  });

  test('skill globs narrow the catalog in one comma-separated flag', () => {
    expect(buildSessionSpawnArgs('', undefined, undefined, { skills: ['review-*', 'pr-*'] })).toEqual([
      '--config',
      titleModelOverlayPath(),
      '--skills=review-*,pr-*',
      ...kabmoExtensionArgs(),
    ]);
  });

  test('an empty prompt and an empty glob list add no argv at all', () => {
    expect(buildSessionSpawnArgs('', undefined, undefined, { systemPrompt: '', skills: [] })).toEqual([
      '--config',
      titleModelOverlayPath(),
      ...kabmoExtensionArgs(),
    ]);
  });

  test('the overlay file EXISTS by the time the argv names it', () => {
    // omp's `--config` loader is strict: a missing file is a hard error, so the
    // file has to be there before the spawn reads the argv.
    const args = buildSessionSpawnArgs('');
    const path = args[args.indexOf('--config') + 1];
    expect(path).toBe(titleModelOverlayPath());
    expect(existsSync(path)).toBe(true);
  });

  test('the extension load is the `-e <existing absolute file>` pair', () => {
    const args = kabmoExtensionArgs();
    expect(args.length === 0 || args[0] === '-e').toBe(true);
    // `isAbsolute`, not `startsWith('/')`: a Windows checkout names it `C:\…`.
    if (args.length > 0) expect(isAbsolute(args[1])).toBe(true);
  });
});
