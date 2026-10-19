// Production-bundle build for the CLI.
//
// `serve` defaults to production and the published tarball ships `dist/client`,
// but a source checkout has to build once. Doing it on demand (rather than
// refusing with "run `bun run build` first") is what makes the default mode work
// in a fresh clone: `bun install` provides Bun and the build script, and every
// bundler dependency is already declared.
//
// Kept apart from runtime.js, which owns process lifecycle and instance
// discovery: this is the one place the CLI executes the bundler.

import fs from 'node:fs';

import { joinPath } from '@/cli/lib/path-utils.js';
import { resolveBunBin } from '@/cli/lib/runtime.js';

/**
 * Build the production bundle when it is missing.
 *
 * The script runs as a child rather than being imported so it uses the
 * package's own bundler options (`bunfig.toml` plugins, the `dist/client`
 * outdir) and prints its own progress, exactly as a manual `bun run build`.
 */
export function buildProductionBundle(pkgRoot, { onLine } = {}) {
  const script = joinPath(pkgRoot, 'scripts', 'build-client.ts');
  if (!fs.existsSync(script)) {
    throw new Error(
      `No production build and no build script at ${script}.\n`
      + 'This install is incomplete — reinstall Kabmo, or run `ompchamber serve --dev`.',
    );
  }

  const result = Bun.spawnSync({
    cmd: [resolveBunBin(), script],
    cwd: pkgRoot,
    env: { ...Bun.env },
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const output = `${result.stdout?.toString() ?? ''}${result.stderr?.toString() ?? ''}`;
  if (typeof onLine === 'function' && output.length > 0) onLine(output);

  if (result.exitCode !== 0) {
    throw new Error(
      `Production build failed (exit ${result.exitCode}).\n${output.trim() || 'No output from the build.'}`,
    );
  }

  return { file: joinPath(pkgRoot, 'dist', 'client', 'index.js'), output };
}
