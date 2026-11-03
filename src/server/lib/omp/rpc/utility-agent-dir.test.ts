/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The MCP-free agent-dir overlay: what the utility child is allowed to see, and
 * what must reach the real tree.
 *
 * The rule this pins is the ONE thing the overlay exists for — `mcp.json` is
 * absent, so omp spawns no MCP process — plus the property that makes deferring
 * to symlinks safe: every other entry still resolves to the real file, so a
 * `logout` or a `models.yml` read sees the user's actual state. A regression to
 * "copy the files" would pass a naive smoke test and silently fork credentials.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import { ensureUtilityAgentDir, removeUtilityAgentDir } from '@/server/lib/omp/rpc/utility-agent-dir';

let realAgentDir = '';
let previousAgentDir: string | undefined;

function write(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

beforeEach(() => {
  realAgentDir = fs.mkdtempSync(path.join(tmpdir(), 'kabmo-util-real-'));
  previousAgentDir = Bun.env.PI_CODING_AGENT_DIR;
  Bun.env.PI_CODING_AGENT_DIR = realAgentDir;
});

afterEach(async () => {
  await removeUtilityAgentDir();
  if (previousAgentDir === undefined) delete Bun.env.PI_CODING_AGENT_DIR;
  else Bun.env.PI_CODING_AGENT_DIR = previousAgentDir;
  fs.rmSync(realAgentDir, { recursive: true, force: true });
});

describe('ensureUtilityAgentDir', () => {
  test('omits mcp.json and sessions, and mirrors every other entry', async () => {
    write(path.join(realAgentDir, 'mcp.json'), '{"mcpServers":{}}');
    write(path.join(realAgentDir, 'models.yml'), 'providers: []\n');
    write(path.join(realAgentDir, 'agent.db'), 'db');
    fs.mkdirSync(path.join(realAgentDir, 'sessions'), { recursive: true });
    fs.mkdirSync(path.join(realAgentDir, 'skills'), { recursive: true });

    const overlay = await ensureUtilityAgentDir();
    expect(overlay).toBeString();

    const entries = fs.readdirSync(overlay!).sort();
    // The whole point of the overlay: no MCP config reaches the child.
    expect(entries).not.toContain('mcp.json');
    // These children run --no-session; a second view of the tree is a bug.
    expect(entries).not.toContain('sessions');
    expect(entries).toContain('models.yml');
    expect(entries).toContain('agent.db');
  });

  test('state files are symlinks to the real ones, so writes land there', async () => {
    write(path.join(realAgentDir, 'models.yml'), 'providers: [kenari]\n');

    const overlay = await ensureUtilityAgentDir();
    const link = path.join(overlay!, 'models.yml');

    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(link)).toBe(fs.realpathSync(path.join(realAgentDir, 'models.yml')));
    // A read through the overlay is the real content, not a stale copy.
    expect(fs.readFileSync(link, 'utf8')).toContain('kenari');
  });

  test('directories are linked, not materialised empty, so discovery sees them', async () => {
    fs.mkdirSync(path.join(realAgentDir, 'skills'), { recursive: true });
    fs.mkdirSync(path.join(realAgentDir, 'skills', 'diagnose'), { recursive: true });

    const overlay = await ensureUtilityAgentDir();
    const mounted = path.join(overlay!, 'skills');

    // An empty stand-in dropped every `skill:` entry from get_available_commands
    // (measured 60 → 52 commands, 1 skill left). The overlay must expose the
    // real root, so a linked child discovers exactly what a plain child does.
    expect(fs.lstatSync(mounted).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(mounted)).toBe(fs.realpathSync(path.join(realAgentDir, 'skills')));
    expect(fs.readdirSync(mounted)).toEqual(['diagnose']);
  });

  test('a second call is idempotent and returns the same directory', async () => {
    write(path.join(realAgentDir, 'models.yml'), 'a\n');

    const first = await ensureUtilityAgentDir();
    const second = await ensureUtilityAgentDir();

    expect(second).toBe(first!);
    expect(fs.readdirSync(second!)).toContain('models.yml');
  });

  test('an unreadable agent dir falls back to undefined rather than failing', async () => {
    Bun.env.PI_CODING_AGENT_DIR = path.join(realAgentDir, 'does-not-exist');
    expect(await ensureUtilityAgentDir()).toBeUndefined();
  });

  test('a file added after the first build appears in the next build', async () => {
    write(path.join(realAgentDir, 'models.yml'), 'a\n');
    const before = await ensureUtilityAgentDir();
    expect(fs.readdirSync(before!)).not.toContain('auth.json');

    write(path.join(realAgentDir, 'auth.json'), '{}');
    await ensureUtilityAgentDir();

    expect(fs.readdirSync(before!)).toContain('auth.json');
  });
});

describe('removeUtilityAgentDir', () => {
  test('removes the overlay but never the real files it linked to', async () => {
    write(path.join(realAgentDir, 'auth.json'), '{"token":"x"}');
    const overlay = await ensureUtilityAgentDir();
    expect(fs.existsSync(overlay!)).toBe(true);

    await removeUtilityAgentDir();

    expect(fs.existsSync(overlay!)).toBe(false);
    expect(fs.readFileSync(path.join(realAgentDir, 'auth.json'), 'utf8')).toBe('{"token":"x"}');
  });

  test('is a no-op when nothing was built', () => {
    expect(removeUtilityAgentDir()).toBeInstanceOf(Promise);
  });
});
