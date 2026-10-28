/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `rg` runner behind the Search panel.
 *
 * `runRipgrep` must stream rg's stdout/stderr verbatim (the route parses
 * `--json` frames out of it) and report rg's exit code, because 0, 1 and 2
 * mean matches, no matches and error. It also resolves a native binary by hand
 * — skipping a `#!` script such as `node_modules/.bin/rg` — and falls back to
 * the WASI build when PATH holds only scripts. These tests run the module
 * against a fixture tree in a temp dir and pin the match/no-match/error exit
 * codes, the binary-file handling, the argv path with a space, the shebang
 * skip, and the WASI fallback.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { nativeRipgrepPath, runRipgrep } from '@/server/lib/fs/ripgrep';
import { testPosix } from '@/test-support/platform';

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kabmo-rg-'));
  tempDirs.push(dir);
  return dir;
}

function write(dir: string, rel: string, content: string): void {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

const fixture = tempDir();
write(fixture, 'a.txt', 'hello needle world\nsecond line\n');
write(fixture, 'my dir/b.txt', 'needle here\n');
write(fixture, 'nomatch.txt', 'nothing to see\n');
write(fixture, 'bin.dat', '\0\0\0needle after nul\n');

interface RgRun {
  code: number;
  stdout: string;
  stderr: string;
}

async function collect(args: string[], cwd: string = fixture): Promise<RgRun> {
  const decoder = new TextDecoder();
  let stdout = '';
  let stderr = '';
  const code = await runRipgrep(args, cwd, {
    onStdout(chunk) {
      stdout += decoder.decode(chunk, { stream: true });
    },
    onStderr(chunk) {
      stderr += decoder.decode(chunk, { stream: true });
    },
  });
  return { code, stdout, stderr };
}

/** Match frames of an rg `--json` stream, as the search route parses them. */
function matchPaths(stdout: string): string[] {
  return stdout
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line))
    .filter((frame) => frame.type === 'match')
    .map((frame) => frame.data?.path?.text as string);
}

afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe('runRipgrep result stream', () => {
  test('a search with matches exits 0 and streams a frame per file', async () => {
    const run = await collect(['--json', '-F', 'needle', '.']);
    expect(run.code).toBe(0);
    expect(run.stderr).toBe('');
    const paths = matchPaths(run.stdout);
    expect(paths).toContain('./a.txt');
    expect(paths).toContain('./my dir/b.txt');
    expect(run.stdout).toContain('"line_number":1');
    // Walking a directory, rg skips the binary file entirely...
    expect(paths).not.toContain('./bin.dat');
  });

  test('a search with no matches exits 1 and streams no match frame', async () => {
    const run = await collect(['--json', '-F', 'zzzznope', '.']);
    expect(run.code).toBe(1);
    expect(run.stderr).toBe('');
    expect(matchPaths(run.stdout)).toEqual([]);
    expect(run.stdout).toContain('"type":"summary"');
  });

  test('a binary file named explicitly is searched, without its NUL bytes', async () => {
    const run = await collect(['--json', '-F', 'needle', 'bin.dat']);
    expect(run.code).toBe(0);
    expect(matchPaths(run.stdout)).toEqual(['bin.dat']);
    // Named directly, rg does search the file, but strips the NULs it had to
    // skip: the match line arrives as plain text and the end frame records
    // where the binary content started.
    expect(run.stdout).toContain('needle after nul');
    expect(run.stdout).not.toContain('\\u0000');
    expect(run.stdout).toContain('"binary_offset"');
  });

  test('-a overrides the binary stripping and yields the raw line', async () => {
    const run = await collect(['--json', '-a', '-F', 'needle', 'bin.dat']);
    expect(run.code).toBe(0);
    expect(matchPaths(run.stdout)).toEqual(['bin.dat']);
    expect(run.stdout).toContain('\\u0000\\u0000\\u0000needle after nul');
  });

  test('a path argument containing a space reaches rg intact', async () => {
    const run = await collect(['--json', '-F', 'needle', 'my dir']);
    expect(run.code).toBe(0);
    expect(matchPaths(run.stdout)).toEqual(['my dir/b.txt']);
    expect(run.stdout).toContain('needle here');
  });

  test('an unreadable target exits 2 and explains itself on stderr', async () => {
    const missing = path.join(fixture, 'no-such-dir');
    const run = await collect(['--json', '-F', 'needle', missing]);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('no-such-dir');
    expect(matchPaths(run.stdout)).toEqual([]);
  });

  test('the sink receives the same bytes the exit code describes', async () => {
    const run = await collect(['--json', '-F', 'second', 'a.txt']);
    expect(run.code).toBe(0);
    expect(matchPaths(run.stdout)).toEqual(['a.txt']);
    expect(run.stdout).toContain('"text":"second line\\n"');
  });
});

describe('nativeRipgrepPath', () => {
  test('answers a stable path or null, never a script', async () => {
    const first = await nativeRipgrepPath();
    expect(await nativeRipgrepPath()).toBe(first);
    if (first !== null) {
      expect(path.isAbsolute(first)).toBe(true);
      expect(fs.readFileSync(first).subarray(0, 2).toString()).not.toBe('#!');
    }
  });
});

describe('PATH resolution', () => {
  const moduleUrl = new URL('./ripgrep.ts', import.meta.url).href;

  function probePathWith(pathValue: string): { binary: string | null; code: number; matches: number } {
    const dir = tempDir();
    const probe = path.join(dir, 'probe.ts');
    // Dynamic import with a runtime-selected specifier: the probe runs in a
    // fresh process so `nativeRipgrepPath`'s process-wide cache starts empty
    // under the PATH this test controls. A static import would bind to the
    // test process, where the cache was already filled against the real PATH.
    fs.writeFileSync(
      probe,
      [
        `const m = await import(${JSON.stringify(moduleUrl)});`,
        `const binary = await m.nativeRipgrepPath();`,
        `let out = '';`,
        `const code = await m.runRipgrep(['--json', '-F', 'needle', '.'], ${JSON.stringify(fixture)}, { onStdout: (c) => { out += new TextDecoder().decode(c); }, onStderr: () => {} });`,
        `const matches = out.split('\\n').filter((l) => l.includes('"type":"match"')).length;`,
        `console.log(JSON.stringify({ binary, code, matches }));`,
      ].join('\n'),
    );
    const result = Bun.spawnSync({
      cmd: [process.execPath, 'run', probe],
      env: { ...Bun.env, PATH: pathValue },
    });
    if (result.exitCode !== 0) {
      throw new Error(`probe failed: ${result.stderr.toString()}`);
    }
    return JSON.parse(result.stdout.toString().trim());
  }

  testPosix('a script on PATH is skipped for the next real binary', () => {
    const scriptDir = tempDir();
    write(scriptDir, 'rg', '#!/usr/bin/env node\nconsole.log("shim");\n');
    fs.chmodSync(path.join(scriptDir, 'rg'), 0o755);
    const nativeDir = tempDir();
    write(nativeDir, 'rg', 'MZnot-a-script');
    fs.chmodSync(path.join(nativeDir, 'rg'), 0o755);

    const probe = probePathWith(`${scriptDir}:${nativeDir}`);
    expect(probe.binary).toBe(path.join(nativeDir, 'rg'));
  });

  testPosix('a PATH of scripts only resolves to null and still searches via WASI', () => {
    const scriptDir = tempDir();
    write(scriptDir, 'rg', '#!/usr/bin/env node\nconsole.log("shim");\n');
    fs.chmodSync(path.join(scriptDir, 'rg'), 0o755);

    const probe = probePathWith(scriptDir);
    expect(probe.binary).toBeNull();
    expect(probe.code).toBe(0);
    expect(probe.matches).toBe(2);
  });
});
