/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `!command` / bare-env indirection omp applies to MCP env and headers.
 *
 * An ACP agent receives the list as JSON and does not run this resolution, so
 * passing the raw value hands it the literal `!echo Bearer $(cat …)` — a header
 * no server accepts. These cases pin the three branches and the omission rule.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { removeDir } from '@/test-support/remove-dir';
import { resolveMcpConfig, resolveMcpValue } from '@/server/lib/mcp/secrets.server';

const ROOT = path.join(os.tmpdir(), `kabmo-mcp-secrets-${process.pid}`);
const previous = Bun.env.KABMO_MCP_TEST_TOKEN;

beforeAll(() => {
  removeDir(ROOT);
  fs.mkdirSync(ROOT, { recursive: true });
  Bun.env.KABMO_MCP_TEST_TOKEN = 'from-env';
});

afterAll(() => {
  if (previous === undefined) delete Bun.env.KABMO_MCP_TEST_TOKEN;
  else Bun.env.KABMO_MCP_TEST_TOKEN = previous;
  removeDir(ROOT);
});

describe('resolveMcpValue', () => {
  test('runs a !command in the project directory and trims its stdout', async () => {
    expect(await resolveMcpValue("!printf 'Bearer abc\\n'", ROOT)).toBe('Bearer abc');
  });

  test('a failed command omits the entry', async () => {
    expect(await resolveMcpValue('!false', ROOT)).toBeNull();
  });

  test('a command that prints only whitespace omits the entry', async () => {
    expect(await resolveMcpValue("!printf '   '", ROOT)).toBeNull();
  });

  test('a bare environment-variable name reads the environment', async () => {
    expect(await resolveMcpValue('KABMO_MCP_TEST_TOKEN', ROOT)).toBe('from-env');
  });

  test('anything else is literal', async () => {
    expect(await resolveMcpValue('Bearer literal', ROOT)).toBe('Bearer literal');
  });
});

describe('resolveMcpConfig', () => {
  test('resolves headers and env, and drops a value that cannot be minted', async () => {
    const config = await resolveMcpConfig(
      {
        type: 'http',
        url: 'http://127.0.0.1:1/mcp',
        headers: { Authorization: "!printf 'Bearer abc'", 'X-Dead': '!false' },
        env: { TOKEN: 'KABMO_MCP_TEST_TOKEN' },
      },
      ROOT,
    );
    expect(config.headers).toEqual({ Authorization: 'Bearer abc' });
    expect(config.env).toEqual({ TOKEN: 'from-env' });
  });

  test('a config with no env or headers is unchanged', async () => {
    const config = await resolveMcpConfig({ command: 'codegraph', args: ['serve'] }, ROOT);
    expect(config).toEqual({ command: 'codegraph', args: ['serve'] });
  });

  test('a non-string value is dropped rather than crashing', async () => {
    const config = await resolveMcpConfig(
      { type: 'http', url: 'http://127.0.0.1:1/mcp', headers: { 'X-Number': 5 as unknown as string } },
      ROOT,
    );
    expect(config.headers).toBeUndefined();
  });
});
