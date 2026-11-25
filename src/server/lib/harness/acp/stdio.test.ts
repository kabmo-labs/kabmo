import { afterEach, describe, expect, test } from 'bun:test';
import { AgentStdio } from '@/server/lib/harness/acp/stdio';

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
      command: [
        '/bin/sh',
        '-c',
        'echo "A=${ANTHROPIC_API_KEY:-missing}"; echo "D=${CLAUDE_CONFIG_DIR:-missing}"',
      ],
      cwd: '/tmp',
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
