/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The server-target build, end to end, on a real plugin directory.
 *
 * The bundled example is the fixture on purpose: it declares BOTH an `app` and
 * a `server`, so this suite pins the two-target build against the one shape
 * that exercises both. A unit test with a synthetic source would pass while the
 * real plugin's `server.ts` failed to resolve `@kabmo-labs/kabmo-sdk` — which
 * is exactly the failure the server target exists to avoid.
 *
 * Slow (an install plus two bundles), so the assertions are grouped into one
 * test rather than spread across several that would each pay for it.
 */

import { describe, expect, test } from 'bun:test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { buildPanelPlugin } from '@/server/lib/panels/build.server';
import { toManifest } from '@/server/lib/panels/manifest';
import { packageDir } from '@/server/lib/fs/package-root';

const BUNDLED_PLUGIN = 'marketplace/plugins/session-info';

/** The example plugin, copied out of the repo so a build cannot write into it. */
async function copyExample(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'omp-plugin-build-'));
  await cp(join(packageDir(), BUNDLED_PLUGIN), join(dir, 'session-info'), { recursive: true });
  return join(dir, 'session-info');
}

describe('buildPanelPlugin with a server entry', () => {
  test('a plugin declaring both app and server produces both bundles', async () => {
    const root = await copyExample();
    try {
      const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { kabmo: unknown };
      const manifest = toManifest(pkg.kabmo, root);
      expect('error' in manifest).toBe(false);
      if ('error' in manifest) return;

      const result = await buildPanelPlugin(root, manifest);
      expect(result.status).toBe('built');

      // The app half is shimmed for the browser: it must NOT carry a Preact of
      // its own, and it must read the host runtime.
      const app = await readFile(join(root, manifest.app ?? ''), 'utf8');
      expect(app).toContain('__kabmoPluginRuntime');
      expect(app).not.toContain('preact/src');

      // The server half is bundled for Bun and carries its dependency: it is
      // imported by absolute path, so nothing would resolve an external one.
      const server = await readFile(join(root, manifest.server ?? ''), 'utf8');
      expect(server).toContain('session-info server half loaded');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 240_000);

  test('a plugin whose server source is missing its declared entry reports the file by name', async () => {
    const root = await copyExample();
    try {
      const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
        kabmo: Record<string, unknown>;
      };
      // Declare a server entry nothing produces: the build must report THAT
      // file rather than a generic failure, or the author has nothing to fix.
      pkg.kabmo.server = 'dist/other.js';
      await writeFile(join(root, 'package.json'), JSON.stringify(pkg, null, 2));

      const manifest = toManifest(pkg.kabmo, root);
      expect('error' in manifest).toBe(false);
      if ('error' in manifest) return;

      const result = await buildPanelPlugin(root, manifest);
      expect(result.status).toBe('failed');
      expect(result.reason).toContain('dist/other.js');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 240_000);
});
