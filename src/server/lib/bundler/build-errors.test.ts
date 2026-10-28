/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { describeShellBuildFailure } from '@/server/lib/bundler/build-errors.server';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'omp-build-errors-'));
  Bun.write(join(root, 'index.html'), '<!doctype html><html><body><script type="module" src="./entry.ts"></script></body></html>');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('describeShellBuildFailure', () => {
  test('names the file, position and message of a syntax error', async () => {
    await Bun.write(join(root, 'entry.ts'), 'const a = 1;\nexport const broken = ;\n');

    const detail = await describeShellBuildFailure(root);

    expect(detail).toContain('entry.ts:2:23');
    expect(detail).toContain('Unexpected ;');
    // The offending source line travels with the message: a file and column
    // alone still leave the reader hunting for the edit.
    expect(detail).toContain('export const broken = ;');
  });

  test('reports an unresolved import that the bundle would use', async () => {
    await Bun.write(join(root, 'entry.ts'), 'import { a } from "./nowhere";\nconsole.log(a);\n');

    expect(await describeShellBuildFailure(root)).toContain('Could not resolve: "./nowhere"');
  });

  test('reports a missing named export, which the route serves as a reload stub', async () => {
    // The route answers 200 for this, so a status-only check calls it healthy —
    // but Bun replaces the bundle with a 104-byte stub that only calls
    // `location.reload()`, so the page cannot run. It is a real failure of the
    // bundle and is reported as one.
    await Bun.write(join(root, 'dep.ts'), 'export const a = 1;\n');
    await Bun.write(join(root, 'entry.ts'), 'import { zzz } from "./dep";\nconsole.log(zzz);\n');

    expect(await describeShellBuildFailure(root)).toContain('No matching export');
  });

  test('stays silent for an unresolved import the bundle would drop anyway', async () => {
    // Tree-shaken away, so the route serves the page fine (verified: 200). A
    // probe that reported it would send the reader after a build error that is
    // not why the page is broken.
    await Bun.write(join(root, 'entry.ts'), 'import x from "./nowhere";\n');

    expect(await describeShellBuildFailure(root)).toBeNull();
  });

  test('returns null for a bundle that builds, so the reason stays the status alone', async () => {
    await Bun.write(join(root, 'entry.ts'), 'console.log("ok");\n');

    expect(await describeShellBuildFailure(root)).toBeNull();
  });

  test('loads the plugins named in bunfig.toml, as the route does', async () => {
    // A plugin that fails a file the route would bundle: if the probe ignored
    // bunfig it would report a clean build and hide the real failure.
    await Bun.write(
      join(root, 'probe-plugin.ts'),
      `import type { BunPlugin } from 'bun';
const plugin: BunPlugin = {
  name: 'probe',
  setup(build) {
    build.onLoad({ filter: /\\.probe\\.ts$/ }, () => ({ contents: 'export const = ;', loader: 'ts' }));
  },
};
export default plugin;
`,
    );
    await Bun.write(join(root, 'bunfig.toml'), '[serve.static]\nplugins = ["./probe-plugin.ts"]\n');
    await Bun.write(join(root, 'entry.ts'), 'import "./thing.probe";\n');
    await Bun.write(join(root, 'thing.probe.ts'), 'export const ok = 1;\n');

    expect(await describeShellBuildFailure(root)).not.toBeNull();
  });

  test('survives a bunfig it cannot parse', async () => {
    await Bun.write(join(root, 'bunfig.toml'), '[serve.static\nplugins = broken\n');
    await Bun.write(join(root, 'entry.ts'), 'console.log("ok");\n');

    expect(await describeShellBuildFailure(root)).toBeNull();
  });
});
