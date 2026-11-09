/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A landed provider write must hand the browser the two facts the card cannot
 * derive itself: the config the server saved and the harness tabs whose cached
 * probe measured the OLD registry. Dropping `probeInvalidated` left the composer
 * picker on a stale model list, because nothing told that tab to probe again.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { addProvider, importProvider } from '@/client/hooks/models/provider-writes';

const realFetch = Bun.fetch;
let bodies: unknown[] = [];
let announceCalls: unknown[][] = [];

function stubFetch(payload: unknown, status = 200): void {
  (globalThis as unknown as Record<string, unknown>).fetch = async (_input: unknown, init?: { body?: string }) => {
    bodies.push(init?.body ? JSON.parse(init.body) : null);
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
}

beforeEach(() => {
  bodies = [];
  announceCalls = [];
});

afterEach(() => {
  (globalThis as unknown as Record<string, unknown>).fetch = realFetch;
});

function announce(id: string, config?: unknown, invalidated?: unknown): void {
  announceCalls.push([id, config, invalidated]);
}

describe('provider writes', () => {
  test('an add announces the saved config and the probes it invalidated', async () => {
    const config = { path: '/home/me/.claude.json' };
    stubFetch({ config, probeInvalidated: ['omp-acp'], protocol: 'anthropic', target: 'anthropic' });

    const outcome = await addProvider('omp-acp', { target: 'registry', id: 'minimax' } as never, announce);

    expect(outcome.problem).toBeNull();
    expect(outcome.detail).toBe('anthropic → anthropic');
    expect(announceCalls).toEqual([['omp-acp', config, ['omp-acp']]]);
    expect(bodies).toEqual([{ probe: 'omp-acp', addProvider: { target: 'registry', id: 'minimax' } }]);
  });

  test('an import carries the row, not the credential', async () => {
    stubFetch({ imported: { id: 'minimax', replaced: false, path: '/w/models.yml', dialect: 'omp', notes: [] } });

    const outcome = await importProvider(
      'omp-acp',
      'minimax',
      { source: 'claude', name: 'MiniMax', baseUrl: 'https://api.minimax.io', protocol: 'anthropic', models: ['m1'], contextWindow: 200_000 } as never,
      announce,
    );

    expect(outcome.problem).toBeNull();
    const body = bodies[0] as { importProvider: { entry: Record<string, unknown> } };
    expect(body.importProvider.entry).not.toHaveProperty('apiKey');
    expect(body.importProvider.entry.models).toEqual(['m1']);
  });

  test('a refused write reports the server reason and announces nothing', async () => {
    stubFetch({ error: 'that harness has no launch command' }, 400);

    const outcome = await addProvider('omp-acp', { target: 'registry' } as never, announce);

    expect(outcome.problem).toBe('that harness has no launch command');
    expect(announceCalls).toEqual([]);
  });
});
