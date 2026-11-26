import { describe, expect, test } from 'bun:test';
import { accountAdapter, accountLoginCommand, shellWord } from './accounts';

describe('saved account adapters', () => {
  test('each supported harness points at the home its CLI actually reads', () => {
    expect(accountAdapter('codex')?.env('/tmp/codex')).toEqual({ CODEX_HOME: '/tmp/codex' });
    expect(accountAdapter('claude')?.env('/tmp/claude')).toEqual({ CLAUDE_CONFIG_DIR: '/tmp/claude' });
    expect(accountAdapter('antigravity')?.env('/tmp/agy')).toMatchObject({
      GEMINI_HOME: '/tmp/agy',
      AGY_ACP_FORCE_FILE_STORAGE: '1',
    });
    expect(accountAdapter('opencode')).toBeNull();
  });

  test('an account strips ambient credentials that could select another login', () => {
    const claude = accountAdapter('claude');
    expect(claude?.stripEnv).toContain('ANTHROPIC_API_KEY');
    expect(claude?.stripEnv).toContain('CLAUDE_CONFIG_DIR');
    expect(accountAdapter('codex')?.stripEnv).toContain('CODEX_HOME');
    // `SSH_CONNECTION` is dropped, then the adapter's own value is applied: the
    // host's connection must not decide whether agy uses a keyring.
    expect(accountAdapter('antigravity')?.stripEnv).toContain('SSH_CONNECTION');
  });

  test('the sign-in line carries the home and the CLI arguments', () => {
    const codex = accountAdapter('codex');
    const claude = accountAdapter('claude');
    const agy = accountAdapter('antigravity');
    expect(codex && accountLoginCommand(codex, '/tmp/codex home')).toBe(
      "CODEX_HOME='/tmp/codex home' codex login",
    );
    expect(claude && accountLoginCommand(claude, '/tmp/claude')).toContain('claude auth login --claudeai');
    expect(agy && accountLoginCommand(agy, '/tmp/agy')).toContain('agy acp --login');
    expect(codex && accountLoginCommand(codex, 'C:\\Users\\me\\kabmo home', 'win32'))
      .toBe('set "CODEX_HOME=C:\\Users\\me\\kabmo home" && codex login');
  });

  test('a path with a quote is still one shell word', () => {
    expect(shellWord("/tmp/it's here")).toBe("'/tmp/it'\\''s here'");
  });
});
