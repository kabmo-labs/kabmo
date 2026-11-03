/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Agents settings route, which reads and writes omp's OWN definition files
 * (`~/.omp/agent/agents/*.md`, `<workspace>/.omp/agents/*.md`).
 *
 * These cases live here rather than in the SQLite-store suite because this route
 * touches no database: the file is the record, and the panel is a view of it.
 * Each case pins a failure a user would otherwise see as "saving did nothing":
 *
 *   - a write lands in the agent dir, and the list answers with the file it
 *     came from, so the pane can rename or delete the right one;
 *   - a rename REMOVES the old file (otherwise one definition survives twice);
 *   - an unsafe file name or an empty prompt is a 400 with a sentence, not a 500;
 *   - MOCK serves the demo presets and refuses to touch disk.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DEFAULT_AGENTS_LIST } from '@/client/data/agent-data';
import { action as agentsAction, loader as agentsLoader } from '@/server/routes/settings/agents';
import { removeDir } from '@/test-support/remove-dir';

const ROOT = path.join(os.tmpdir(), 'omc-settings-agents-route-test');
const API = 'http://localhost/api/settings';
const ORIGINAL_AGENT_DIR = Bun.env.PI_CODING_AGENT_DIR;

beforeAll(() => {
  removeDir(ROOT);
  fs.mkdirSync(path.join(ROOT, 'agent'), { recursive: true });
  Bun.env.PI_CODING_AGENT_DIR = path.join(ROOT, 'agent');
  delete Bun.env.MOCK;
});

afterAll(() => {
  if (ORIGINAL_AGENT_DIR === undefined) delete Bun.env.PI_CODING_AGENT_DIR;
  else Bun.env.PI_CODING_AGENT_DIR = ORIGINAL_AGENT_DIR;
  delete Bun.env.MOCK;
  removeDir(ROOT);
});

type Handler = (args: never) => unknown;

function call(handler: Handler, request: Request): Promise<Response> {
  return handler({ request, params: {} } as never) as Promise<Response>;
}

function send(url: string, verb: string, body?: unknown): Request {
  return new Request(url, {
    method: verb,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  });
}

describe('settings agents', () => {
  test('the list is omp’s definition files, with the file each one came from', async () => {
    await call(agentsAction, send(`${API}/agents`, 'POST', {
      type: 'write', fileName: 'reviewer', name: 'Reviewer', systemPrompt: 'You review.',
    }));
    const body = await (await call(agentsLoader, new Request(`${API}/agents`))).json();
    expect(body.isMock).toBe(false);
    expect(body.agents).toHaveLength(1);
    expect(body.agents[0]).toMatchObject({
      id: 'omp-user-reviewer',
      name: 'Reviewer',
      scope: 'user',
      sourceRoot: 'user',
      fileName: 'reviewer',
      isBuiltIn: false,
    });
    expect(body.agents[0].filePath).toEndWith('reviewer.md');
    await call(agentsAction, send(`${API}/agents`, 'POST', { type: 'delete', fileName: 'reviewer' }));
  });

  test('a write lands in the agent dir and a rename removes the old file', async () => {
    const written = await call(agentsAction, send(`${API}/agents`, 'POST', {
      type: 'write', fileName: 'helper', name: 'Helper', systemPrompt: 'You help.',
    }));
    expect(written.status).toBe(200);
    expect((await written.json()).path).toEndWith('helper.md');

    const renamed = await call(agentsAction, send(`${API}/agents`, 'POST', {
      type: 'write', fileName: 'helper-2', name: 'Helper 2', previousFileName: 'helper', systemPrompt: 'You help twice.',
    }));
    expect(renamed.status).toBe(200);
    expect(fs.readdirSync(path.join(ROOT, 'agent', 'agents'))).toEqual(['helper-2.md']);

    const deleted = await call(agentsAction, send(`${API}/agents`, 'POST', { type: 'delete', fileName: 'helper-2' }));
    expect(deleted.status).toBe(200);
    expect((await deleted.json()).agents).toEqual([]);
  });

  test('a definition carries every key the pane offers, and nothing it does not', async () => {
    await call(agentsAction, send(`${API}/agents`, 'POST', {
      type: 'write',
      fileName: 'tuned',
      name: 'Tuned',
      description: 'Capabilities pinned',
      model: 'kenari/deepseek-v4-1-flash',
      thinkingLevel: 'high',
      tools: ['read', 'grep'],
      spawns: '*',
      systemPrompt: 'You are tuned.',
    }));
    const file = fs.readFileSync(path.join(ROOT, 'agent', 'agents', 'tuned.md'), 'utf8');
    expect(file).toContain('model: "kenari/deepseek-v4-1-flash"');
    expect(file).toContain('thinkingLevel: high');
    expect(file).toContain('tools: read, grep');
    expect(file).toContain('spawns: "*"');
    // omp ignores these three, so writing them would be dead config.
    expect(file).not.toContain('mode:');
    expect(file).not.toContain('temperature');
    expect(file).not.toContain('top_p');

    const body = await (await call(agentsLoader, new Request(`${API}/agents`))).json();
    expect(body.agents[0]).toMatchObject({
      name: 'Tuned',
      model: 'kenari/deepseek-v4-1-flash',
      thinkingLevel: 'high',
      tools: ['read', 'grep'],
      spawns: '*',
    });
    await call(agentsAction, send(`${API}/agents`, 'POST', { type: 'delete', fileName: 'tuned' }));
  });

  test('deleting a file that does not exist names it', async () => {
    const missing = await call(agentsAction, send(`${API}/agents`, 'POST', { type: 'delete', fileName: 'gone' }));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'No agent file named “gone”' });
  });

  test('an invalid file name and an empty prompt are 400 refusals', async () => {
    const badName = await call(agentsAction, send(`${API}/agents`, 'POST', { type: 'write', fileName: 'bad name', systemPrompt: 'x' }));
    expect(badName.status).toBe(400);
    expect(await badName.json()).toEqual({
      error: 'Agent file name may contain letters, numbers, dots, dashes, and underscores',
    });

    const empty = await call(agentsAction, send(`${API}/agents`, 'POST', { type: 'write', fileName: 'ok', systemPrompt: '   ' }));
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({ error: 'Agent system prompt cannot be empty' });
  });

  test('an unknown action is refused rather than silently ignored', async () => {
    const res = await call(agentsAction, send(`${API}/agents`, 'POST', { type: 'write_native', fileName: 'x' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Unknown action “write_native”' });
  });

  test('MOCK serves the demo presets and refuses every write', async () => {
    Bun.env.MOCK = 'true';
    const write = await call(agentsAction, send(`${API}/agents`, 'POST', { type: 'write', fileName: 'x', systemPrompt: 'y' }));
    expect(write.status).toBe(400);
    expect(await write.json()).toEqual({ error: 'Agent files cannot be written in mock mode' });

    const body = await (await call(agentsLoader, new Request(`${API}/agents`))).json();
    expect(body.isMock).toBe(true);
    expect(body.agents).toHaveLength(DEFAULT_AGENTS_LIST.length);
    Bun.env.MOCK = 'false';
  });

  test('a wrong verb is the route-owned 405', async () => {
    const res = await call(agentsAction, send(`${API}/agents`, 'PATCH'));
    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({ error: 'Method not allowed' });
  });
});
