/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `fs:` topic's default root, and its agreement with the HTTP route.
 *
 * The Files panel renders the topic's payload, while every `/api/fs/*` route
 * resolves the same tree through `getDefaultFsRoot(isMockMode())`. The topic
 * hardcoded `false`, so a MOCK capture listed the app's own checkout while the
 * HTTP path listed the bundled `examples` tree — the panel showed the developer's
 * repository in a demo screenshot. Both paths must answer the same root.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { basename } from 'node:path';

import { workspaceDescriptor } from '@/server/lib/realtime/topics/workspace.server';

const originalMock = Bun.env.MOCK;

beforeAll(() => {
  Bun.env.MOCK = 'true';
});

afterAll(() => {
  if (originalMock === undefined) delete Bun.env.MOCK;
  else Bun.env.MOCK = originalMock;
});

describe('workspace fs topic', () => {
  test('mock mode lists the bundled examples tree, like the HTTP route', async () => {
    const payload = (await workspaceDescriptor('fs')('').resolve('fs:')) as {
      root: string;
      files: { name: string }[];
    };

    // `basename`, not `endsWith('/examples')`: the root is a host path, and the
    // Windows gate answers `…\examples`.
    expect(basename(payload.root)).toBe('examples');
    expect(payload.files.map((file) => file.name)).toContain('index.js');
  });
});
