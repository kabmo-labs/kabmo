import { afterEach, describe, expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { AgentStdio } from './stdio';

// The child is this same Bun binary, not `/bin/sh`: Windows has no `/bin/sh`
// (the suite died there with `uv_spawn '/bin/sh'` ENOENT) and the assertion is
// about the environment a child receives, which Bun reads identically on every
// platform. One interpreter, one program, both legs covered.
const PRINT_ENV = [
  'console.log(`A=${process.env.ANTHROPIC_API_KEY ?? "missing"}`)',
  'console.log(`D=${process.env.CLAUDE_CONFIG_DIR ?? "missing"}`)',
].join(';');

const saved = Bun.env.ANTHROPIC_API_KEY;

afterEach(() => {
  if (saved === undefined) delete Bun.env.ANTHROPIC_API_KEY;
  else Bun.env.ANTHROPIC_API_KEY = saved;
});

function run(envDrop?: readonly string[]): Promise<string[]> {
  const lines: string[] = [];
  const { promise, resolve } = Promise.withResolvers<string[]>();
  new AgentStdio(
    {
      command: [process.execPath, '-e', PRINT_ENV],
      cwd: tmpdir(),
      env: { CLAUDE_CONFIG_DIR: '/home/account' },
      ...(envDrop ? { envDrop } : {}),
    },
    {
      onLine: (line) => lines.push(line),
      onExit: () => resolve(lines),
    },
  );
  return promise;
}

describe('account env at the spawn boundary', () => {
  test('a dropped ambient credential cannot authenticate the selected account', async () => {
    Bun.env.ANTHROPIC_API_KEY = 'host-leak';
    const lines = await run(['ANTHROPIC_API_KEY']);
    expect(lines).toContain('A=missing');
    expect(lines).toContain('D=/home/account');
  });

  test('without an account the host environment is left alone', async () => {
    Bun.env.ANTHROPIC_API_KEY = 'host-key';
    const lines = await run();
    expect(lines).toContain('A=host-key');
  });
});
