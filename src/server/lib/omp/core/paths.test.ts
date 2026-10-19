/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Agent-directory resolution is the seam between Kabmo and a real omp
 * install: every session, plugin and registry read hangs off these paths, so a
 * wrong answer silently shows an empty sidebar instead of an error.
 *
 * The risky rules pinned here are omp's own and easy to "fix" into breakage:
 * `PI_CONFIG_DIR`/`PI_CODING_AGENT_DIR` relocations, the XDG data layout that is
 * honored ONLY when `$XDG_DATA_HOME/omp` already exists, the project plugin walk
 * that must stop before `$HOME` (or `~/.omp` would alias a project anchor), and
 * the session-slug encoding whose three branches produce three different shapes.
 * All filesystem work is inside a temp dir; the real home and agent dir are
 * never touched.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import * as path from 'node:path';
import { testPosix } from '@/test-support/platform';

import {
  canonicalize,
  getAgentDir,
  getConfigDirName,
  getConfigRoot,
  getMarketplacesRegistryPath,
  getPluginsDir,
  getProjectPluginsDir,
  getProjectsRegistryPath,
  getSessionDirNameForCwd,
  getSessionsDir,
  pathExists,
  projectPathKey,
} from '@/server/lib/omp/core/paths';

const ENV_KEYS = ['PI_CONFIG_DIR', 'PI_CODING_AGENT_DIR', 'XDG_DATA_HOME'] as const;
type EnvKey = (typeof ENV_KEYS)[number];
const savedEnv: Record<EnvKey, string | undefined> = {
  PI_CONFIG_DIR: Bun.env.PI_CONFIG_DIR,
  PI_CODING_AGENT_DIR: Bun.env.PI_CODING_AGENT_DIR,
  XDG_DATA_HOME: Bun.env.XDG_DATA_HOME,
};

const tempDirs: string[] = [];

function tempDir(prefix = 'kabmo-test-'): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function setEnv(key: EnvKey, value: string | undefined): void {
  if (value === undefined) delete Bun.env[key];
  else Bun.env[key] = value;
}

afterEach(() => {
  for (const key of ENV_KEYS) setEnv(key, savedEnv[key]);
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const onPosix = process.platform === 'darwin' || process.platform === 'linux';

describe('config root and agent dir', () => {
  test('the config root is ~/.omp, renamed by PI_CONFIG_DIR', () => {
    setEnv('PI_CONFIG_DIR', undefined);
    expect(getConfigDirName()).toBe('.omp');
    expect(getConfigRoot()).toBe(path.join(homedir(), '.omp'));

    setEnv('PI_CONFIG_DIR', 'omp-alt');
    expect(getConfigDirName()).toBe('omp-alt');
    expect(getConfigRoot()).toBe(path.join(homedir(), 'omp-alt'));
  });

  test('the agent dir is <configRoot>/agent by default', () => {
    setEnv('PI_CONFIG_DIR', undefined);
    setEnv('PI_CODING_AGENT_DIR', undefined);
    expect(getAgentDir()).toBe(path.join(homedir(), '.omp', 'agent'));
  });

  test('PI_CODING_AGENT_DIR overrides and is resolved to an absolute path', () => {
    setEnv('PI_CODING_AGENT_DIR', 'relative/agent');
    expect(getAgentDir()).toBe(path.resolve('relative/agent'));
  });

  test('the projects registry always lives under the agent dir', () => {
    const dir = tempDir();
    setEnv('XDG_DATA_HOME', dir);
    mkdirSync(path.join(dir, 'omp'), { recursive: true });
    setEnv('PI_CODING_AGENT_DIR', undefined);
    expect(getProjectsRegistryPath()).toBe(path.join(homedir(), '.omp', 'agent', 'projects.json'));
  });
});

describe('XDG data layout', () => {
  test.skipIf(!onPosix)('XDG is ignored until $XDG_DATA_HOME/omp exists', () => {
    const dir = tempDir();
    setEnv('PI_CODING_AGENT_DIR', undefined);
    setEnv('PI_CONFIG_DIR', undefined);
    setEnv('XDG_DATA_HOME', dir);

    expect(getSessionsDir()).toBe(path.join(homedir(), '.omp', 'agent', 'sessions'));
    expect(getPluginsDir()).toBe(path.join(homedir(), '.omp', 'plugins'));
    expect(getMarketplacesRegistryPath()).toBe(path.join(homedir(), '.omp', 'marketplaces.json'));
  });

  test.skipIf(!onPosix)('once the app root exists, XDG flattens the agent/ prefix', () => {
    const dir = tempDir();
    mkdirSync(path.join(dir, 'omp'), { recursive: true });
    setEnv('PI_CODING_AGENT_DIR', undefined);
    setEnv('PI_CONFIG_DIR', undefined);
    setEnv('XDG_DATA_HOME', dir);

    expect(getSessionsDir()).toBe(path.join(dir, 'omp', 'sessions'));
    expect(getPluginsDir()).toBe(path.join(dir, 'omp', 'plugins'));
    expect(getMarketplacesRegistryPath()).toBe(path.join(dir, 'omp', 'marketplaces.json'));
  });

  test.skipIf(!onPosix)('an agent-dir override disables the XDG layout', () => {
    const dir = tempDir();
    const agent = tempDir();
    mkdirSync(path.join(dir, 'omp'), { recursive: true });
    setEnv('XDG_DATA_HOME', dir);
    setEnv('PI_CODING_AGENT_DIR', agent);

    expect(getSessionsDir()).toBe(path.join(agent, 'sessions'));
    expect(getPluginsDir()).toBe(path.join(homedir(), '.omp', 'plugins'));
  });

  test.skipIf(!onPosix)('an override equal to the default agent dir still counts as default', () => {
    const dir = tempDir();
    mkdirSync(path.join(dir, 'omp'), { recursive: true });
    setEnv('PI_CONFIG_DIR', undefined);
    setEnv('XDG_DATA_HOME', dir);
    setEnv('PI_CODING_AGENT_DIR', path.join(homedir(), '.omp', 'agent'));

    expect(getSessionsDir()).toBe(path.join(dir, 'omp', 'sessions'));
  });
});

describe('getProjectPluginsDir', () => {
  test('the nearest ancestor holding .omp wins', () => {
    const root = tempDir();
    mkdirSync(path.join(root, '.omp'));
    const child = path.join(root, 'pkg', 'src');
    mkdirSync(child, { recursive: true });

    expect(getProjectPluginsDir(root)).toBe(path.join(root, '.omp', 'plugins'));
    expect(getProjectPluginsDir(child)).toBe(path.join(root, '.omp', 'plugins'));
  });

  test('.omp is preferred over .git at the same level', () => {
    const root = tempDir();
    mkdirSync(path.join(root, '.git'));
    const child = path.join(root, 'pkg');
    mkdirSync(path.join(child, '.omp'), { recursive: true });

    expect(getProjectPluginsDir(child)).toBe(path.join(child, '.omp', 'plugins'));
  });

  test('.git is the fallback anchor when no .omp exists', () => {
    const root = tempDir();
    mkdirSync(path.join(root, '.git'));
    const child = path.join(root, 'pkg');
    mkdirSync(child, { recursive: true });

    expect(getProjectPluginsDir(child)).toBe(path.join(root, '.omp', 'plugins'));
  });

  test('with no anchor at all the cwd itself is the project root', () => {
    const root = tempDir();
    expect(getProjectPluginsDir(root)).toBe(path.join(root, '.omp', 'plugins'));
  });
});

describe('canonicalize / pathExists / projectPathKey', () => {
  test('canonicalize resolves an existing path and leaves a missing one alone', () => {
    const dir = tempDir();
    expect(canonicalize(dir)).toBe(realpathSync.native(dir));
    const missing = path.join(dir, 'nope', 'deep');
    expect(canonicalize(missing)).toBe(missing);
  });

  test('pathExists answers true for a directory and a file, false for missing', async () => {
    const dir = tempDir();
    const file = path.join(dir, 'f.txt');
    writeFileSync(file, 'x');
    expect(await pathExists(dir)).toBe(true);
    expect(await pathExists(file)).toBe(true);
    expect(await pathExists(path.join(dir, 'missing'))).toBe(false);
  });

  test('projectPathKey strips trailing separators from a missing path', () => {
    const missing = path.join(tmpdir(), 'kabmo-missing-key', 'sub');
    expect(projectPathKey(`${missing}///`)).toBe(missing);
    // The root path itself is never reduced to empty; the HOST's root spelling
    // (`/` on POSIX, a drive such as `C:\` on Windows) is what a caller passes.
    const root = path.parse(tmpdir()).root;
    expect(projectPathKey(root)).toBe(root);
  });
});

describe('getSessionDirNameForCwd', () => {
  test('$HOME itself is the bare prefix', () => {
    expect(getSessionDirNameForCwd(homedir())).toBe('-');
  });

  test('a path under $HOME is dashed relative to home', () => {
    expect(getSessionDirNameForCwd(path.join(homedir(), 'proj'))).toBe('-proj');
    expect(getSessionDirNameForCwd(path.join(homedir(), 'proj', 'sub'))).toBe('-proj-sub');
  });

  // On Windows `tmpdir()` lives UNDER `homedir()` (`%USERPROFILE%\AppData\Local\Temp`),
  // so the home branch wins and there is no observable "under tmpdir but not home"
  // shape; both encodings the cases pin are POSIX-only path shapes.
  testPosix('a path under tmpdir uses the -tmp prefix', () => {
    const dir = tempDir();
    expect(getSessionDirNameForCwd(dir)).toBe(`-tmp-${path.basename(dir)}`);
  });

  testPosix('a path outside home and tmp falls back to the legacy absolute encoding', () => {
    expect(getSessionDirNameForCwd('/opt/kabmo-proj')).toBe('--opt-kabmo-proj--');
  });
});
