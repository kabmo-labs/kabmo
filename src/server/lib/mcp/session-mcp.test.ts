/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The per-session MCP override store and the agent-dir overlay it builds.
 *
 * The contract these pin: an override is a MAP (both directions are real), a
 * toggle back to the configured state removes the entry, and the overlay is a
 * real agent dir — every other entry symlinked, `mcp.json` written from the
 * merged list, and the project's own file switched off for the child.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { removeDir } from '@/test-support/remove-dir';
import {
  clearSessionMcpOverrides,
  readSessionMcpOverrides,
  writeSessionMcpOverrides,
} from '@/server/lib/mcp/session-state.server';
import {
  ensureSessionMcpOverlay,
  removeSessionMcpOverlay,
  sessionMcpOverlayDir,
} from '@/server/lib/mcp/session-overlay.server';
import { sessionMcpSpawn } from '@/server/lib/omp/rpc/spawn-mcp';
import { cachedMcpProbe, probeMcpServer } from '@/server/lib/mcp/probe.server';
import { mcpServerEntriesFor } from '@/server/lib/mcp/registry.server';

const ROOT = path.join(os.tmpdir(), `kabmo-session-mcp-${process.pid}`);
const AGENT = path.join(ROOT, 'agent');
const PROJECT = path.join(ROOT, 'project');
const SESSION = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const previousAgentDir = Bun.env.PI_CODING_AGENT_DIR;

beforeAll(async () => {
  removeDir(ROOT);
  fs.mkdirSync(AGENT, { recursive: true });
  fs.mkdirSync(path.join(PROJECT, '.omp'), { recursive: true });
  Bun.env.PI_CODING_AGENT_DIR = AGENT;
  fs.writeFileSync(
    path.join(AGENT, 'mcp.json'),
    JSON.stringify({
      mcpServers: {
        alpha: { command: 'alpha-cmd' },
        beta: { command: 'beta-cmd' },
        off: { command: 'off-cmd' },
      },
      disabledServers: ['off'],
    }),
  );
  fs.writeFileSync(path.join(AGENT, 'config.yml'), 'theme:\n  dark: titanium\n');
  fs.writeFileSync(
    path.join(PROJECT, '.omp', 'mcp.json'),
    JSON.stringify({ mcpServers: { gamma: { command: 'gamma-cmd' } } }),
  );
});

afterAll(async () => {
  await releaseDb();
  if (previousAgentDir === undefined) delete Bun.env.PI_CODING_AGENT_DIR;
  else Bun.env.PI_CODING_AGENT_DIR = previousAgentDir;
  removeDir(ROOT);
});

beforeEach(async () => {
  await isolateDb();
  await removeSessionMcpOverlay(SESSION);
});

describe('session MCP overrides', () => {
  test('round-trips both directions and drops the row when empty', async () => {
    expect(await readSessionMcpOverrides(SESSION)).toEqual({});
    await writeSessionMcpOverrides(SESSION, { beta: false, off: true });
    expect(await readSessionMcpOverrides(SESSION)).toEqual({ beta: false, off: true });
    await writeSessionMcpOverrides(SESSION, {});
    expect(await readSessionMcpOverrides(SESSION)).toEqual({});
  });

  test('clear removes the row', async () => {
    await writeSessionMcpOverrides(SESSION, { beta: false });
    await clearSessionMcpOverrides(SESSION);
    expect(await readSessionMcpOverrides(SESSION)).toEqual({});
  });
});

describe('session MCP overlay', () => {
  test('writes the merged list with the session enablement, and symlinks the rest', async () => {
    const overlay = await ensureSessionMcpOverlay(SESSION, PROJECT, { beta: false, off: true });
    expect(overlay).toBeDefined();
    const dir = sessionMcpOverlayDir(SESSION);
    expect(overlay?.dir).toBe(dir);

    const written = JSON.parse(fs.readFileSync(path.join(dir, 'mcp.json'), 'utf8')) as {
      mcpServers: Record<string, { command?: string; enabled?: boolean }>;
    };
    // `beta` is disabled for this session; `off` was disabled in the file and
    // the session turned it back on; `gamma` comes from the project file.
    expect(written.mcpServers.beta).toEqual({ command: 'beta-cmd', enabled: false });
    expect(written.mcpServers.off).toEqual({ command: 'off-cmd' });
    expect(written.mcpServers.gamma).toEqual({ command: 'gamma-cmd' });
    expect(written.mcpServers.alpha).toEqual({ command: 'alpha-cmd' });

    // Everything else is the real agent dir, so auth/sessions/config stay one copy.
    expect(fs.lstatSync(path.join(dir, 'config.yml')).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'config.yml'), 'utf8')).toContain('titanium');
    // The secondary user file is NOT linked: it would resurrect a disabled server.
    expect(fs.existsSync(path.join(dir, '.mcp.json'))).toBe(false);

    expect(fs.readFileSync(overlay?.configPath ?? '', 'utf8')).toContain('enableProjectConfig: false');
  });

  test('no overrides means no overlay', async () => {
    await ensureSessionMcpOverlay(SESSION, PROJECT, { beta: false });
    expect(fs.existsSync(sessionMcpOverlayDir(SESSION))).toBe(true);
    expect(await ensureSessionMcpOverlay(SESSION, PROJECT, {})).toBeUndefined();
    expect(fs.existsSync(sessionMcpOverlayDir(SESSION))).toBe(false);
  });

  test('keep builds the full list for a live child whose last override was removed', async () => {
    const overlay = await ensureSessionMcpOverlay(SESSION, PROJECT, {}, { keep: true });
    expect(overlay).toBeDefined();
    const written = JSON.parse(fs.readFileSync(path.join(sessionMcpOverlayDir(SESSION), 'mcp.json'), 'utf8')) as {
      mcpServers: Record<string, { command?: string; enabled?: boolean }>;
    };
    expect(written.mcpServers.beta).toEqual({ command: 'beta-cmd' });
    expect(written.mcpServers.off).toEqual({ command: 'off-cmd', enabled: false });
  });
});

describe('session MCP spawn wiring', () => {
  test('a session with overrides points the child at the overlay', async () => {
    await writeSessionMcpOverrides(SESSION, { beta: false });
    const spawn = await sessionMcpSpawn(SESSION, PROJECT, { KABMO_MODES: 'plan' });
    const overlay = spawn.overlay;
    if (!overlay) throw new Error('expected an overlay for a session with overrides');
    expect(overlay.dir).toBe(sessionMcpOverlayDir(SESSION));
    expect(spawn.extraArgs).toEqual(['--config', overlay.configPath]);
    expect(spawn.env).toEqual({ KABMO_MODES: 'plan', PI_CODING_AGENT_DIR: overlay.dir });
  });

  test('a session without overrides keeps the real agent dir', async () => {
    const spawn = await sessionMcpSpawn(SESSION, PROJECT, undefined);
    expect(spawn.overlay).toBeUndefined();
    expect(spawn.extraArgs).toEqual([]);
    expect(spawn.env).toBeUndefined();
  });
});

describe('session MCP probe', () => {
  test('a failed handshake is cached per session and server', async () => {
    const entries = await mcpServerEntriesFor(PROJECT, { sources: ['user', 'project'] });
    const broken = { ...entries[0], name: 'broken', config: { command: 'definitely-not-a-real-binary' } };
    expect(cachedMcpProbe(SESSION, 'broken')).toBeUndefined();
    const result = await probeMcpServer(SESSION, broken, PROJECT);
    expect(result.ok).toBe(false);
    expect(cachedMcpProbe(SESSION, 'broken')).toEqual(result);
  });
});
