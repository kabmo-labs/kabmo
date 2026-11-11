/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A harness the user adds, end to end through the route.
 *
 * The transport was already generic; what these tests pin is the registry the
 * synchronous call sites read: a saved row must become a descriptor, a launch
 * line, a catalog entry and a probe target, and a removal must take all four
 * away without rewriting the chats that ran on it.
 */

import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { getDb } from '@/server/db.server';
import { action, loader } from '@/server/routes/harness/root';
import { loadHarnessConfig, resolveLaunch } from '@/server/lib/harness/config.server';
import { customHarness, refreshCustomHarnesses } from '@/server/lib/harness/custom.server';
import { harnessDescriptor } from '@/shared/lib/harness/catalog';

const API = 'http://localhost/api/harness';

type Handler = (args: never) => unknown;

function call(handler: Handler, request: Request): Promise<Response> {
  return handler({ request, params: {} } as never) as Promise<Response>;
}

function post(body: unknown): Request {
  return new Request(API, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

/** The route's refusal sentence, narrowed rather than cast. */
async function errorOf(response: Response): Promise<string> {
  const payload: unknown = await response.json();
  if (payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string') {
    return payload.error;
  }
  return '';
}

async function add(overrides: Record<string, unknown> = {}): Promise<Response> {
  return call(action, post({
    customHarness: {
      id: 'my-agent',
      label: 'My Agent',
      command: 'npx -y my-agent acp',
      ...overrides,
    },
  }));
}

beforeEach(async () => {
  await isolateDb();
  await (await getDb()).run('DELETE FROM custom_harnesses');
  await refreshCustomHarnesses();
});

afterAll(async () => {
  await releaseDb();
});

describe('custom harness route', () => {
  test('a saved harness becomes a descriptor and a launch line', async () => {
    const response = await add({ env: 'TOKEN=abc' });
    expect(response.status).toBe(200);

    expect(customHarness('my-agent')?.label).toBe('My Agent');
    expect(harnessDescriptor('my-agent')).toMatchObject({
      id: 'my-agent',
      label: 'My Agent',
      transport: 'acp',
      glyph: 'custom',
    });
    const launch = resolveLaunch('my-agent', await loadHarnessConfig('my-agent'));
    expect(launch.command).toEqual(['npx', '-y', 'my-agent', 'acp']);
    expect(launch.env).toEqual({ TOKEN: 'abc' });
  });

  test('the catalog lists it with custom and initial', async () => {
    await add();
    const response = await call(loader, new Request(API));
    const payload = (await response.json()) as { harnesses: Array<Record<string, unknown>> };
    const row = payload.harnesses.find((entry) => entry.id === 'my-agent');
    expect(row).toMatchObject({ custom: true, label: 'My Agent', initial: 'M', transport: 'acp' });
  });

  test('a built-in id is refused by name', async () => {
    const response = await add({ id: 'claude' });
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toContain('already ships');
  });

  test('a malformed id is refused', async () => {
    const response = await add({ id: 'My Agent!' });
    expect(response.status).toBe(400);
  });

  test('an empty command is refused', async () => {
    const response = await add({ command: '   ' });
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toContain('command is required');
  });

  test('an invalid env line is refused', async () => {
    const response = await add({ env: 'NOT A LINE' });
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toContain('invalid env line');
  });

  test('removal drops the descriptor and the launch line', async () => {
    await add();
    const response = await call(action, post({ removeHarness: 'my-agent' }));
    expect(response.status).toBe(200);
    expect(customHarness('my-agent')).toBeUndefined();
    expect(harnessDescriptor('my-agent')).toBeUndefined();
    expect(() => resolveLaunch('my-agent', { command: '', env: '', provider: '', model: '', thinking: '', mode: '' }))
      .toThrow('No launch command is configured');
  });

  test('a built-in cannot be removed', async () => {
    const response = await call(action, post({ removeHarness: 'claude' }));
    expect(response.status).toBe(400);
  });
});
