/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The three agents whose CLI keeps a login in a home directory Kabmo can own.
 *
 * The seam is the CLI's, not Kabmo's: Codex and Claude accept a home variable,
 * so an account is a directory. Antigravity's `agy` also reads `GEMINI_HOME`,
 * but only stays off the shared OS keyring when it believes it runs over SSH,
 * so its recipe carries the same two variables t3code measured.
 *
 * This module is shared with the browser: the settings panel renders the exact
 * login command the server would run, and the spawn uses the same env map. One
 * table is what keeps those two from disagreeing.
 */

export const ACCOUNT_HARNESSES = ['codex', 'claude', 'antigravity'] as const;
export type AccountHarness = (typeof ACCOUNT_HARNESSES)[number];

export interface HarnessAccountAdapter {
  harness: AccountHarness;
  label: string;
  /** The variable the agent reads as its home. */
  homeEnv: string;
  /** Binary and arguments for a sign-in run against this home. */
  loginBinary: string;
  loginArgs: readonly string[];
  /** Env for both sign-in and launch. */
  env(home: string): Record<string, string>;
  /**
   * Ambient variables that select or authenticate ANOTHER account. Removed
   * before the account env is applied, so a host `ANTHROPIC_API_KEY` cannot
   * silently win over the saved login.
   */
  stripEnv: readonly string[];
  /** Where an OAuth login lands, relative to the home. Used for status only. */
  credentialFiles: readonly string[];
}

const ANTIGRAVITY_SSH = '127.0.0.1 0 127.0.0.1 0';

const CODEX_STRIP = [
  'CODEX_HOME',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'CODEX_API_KEY',
  'CHATGPT_API_KEY',
] as const;

const CLAUDE_STRIP = [
  'CLAUDE_CONFIG_DIR',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_CUSTOM_HEADERS',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'AWS_BEARER_TOKEN_BEDROCK',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
] as const;

const ANTIGRAVITY_STRIP = [
  'GEMINI_HOME',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_CLOUD_PROJECT',
  'GOOGLE_CLOUD_LOCATION',
  'GOOGLE_CLOUD_QUOTA_PROJECT',
  'GOOGLE_GENAI_USE_VERTEXAI',
  'GCLOUD_PROJECT',
  'CLOUDSDK_CORE_PROJECT',
  'AGY_ACP_CCPA_PROJECT',
  'AGY_ACP_ENABLE_OAUTH',
  'AGY_ACP_FORCE_FILE_STORAGE',
  'SSH_CONNECTION',
] as const;

const ADAPTERS: Record<AccountHarness, HarnessAccountAdapter> = {
  codex: {
    harness: 'codex',
    label: 'Codex',
    homeEnv: 'CODEX_HOME',
    loginBinary: 'codex',
    loginArgs: ['login'],
    env: (home) => ({ CODEX_HOME: home }),
    stripEnv: CODEX_STRIP,
    credentialFiles: ['auth.json'],
  },
  claude: {
    harness: 'claude',
    label: 'Claude Code',
    homeEnv: 'CLAUDE_CONFIG_DIR',
    loginBinary: 'claude',
    loginArgs: ['auth', 'login', '--claudeai'],
    env: (home) => ({ CLAUDE_CONFIG_DIR: home }),
    stripEnv: CLAUDE_STRIP,
    credentialFiles: ['.claude.json', '.credentials.json'],
  },
  antigravity: {
    harness: 'antigravity',
    label: 'Antigravity',
    homeEnv: 'GEMINI_HOME',
    loginBinary: 'agy',
    loginArgs: ['acp', '--login'],
    env: (home) => ({
      GEMINI_HOME: home,
      AGY_ACP_FORCE_FILE_STORAGE: '1',
      // Without this, `agy` keeps every profile in one OS keyring entry.
      SSH_CONNECTION: ANTIGRAVITY_SSH,
    }),
    stripEnv: ANTIGRAVITY_STRIP,
    credentialFiles: ['antigravity-acp/acp_token.json'],
  },
};

export function accountAdapter(harness: string): HarnessAccountAdapter | null {
  return (ADAPTERS as Record<string, HarnessAccountAdapter | undefined>)[harness] ?? null;
}

/** Single-quote a shell word, the way a POSIX shell expects a literal path. */
export function shellWord(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** The line a user runs in a terminal to sign this home in. */
export function accountLoginCommand(
  adapter: HarnessAccountAdapter,
  home: string,
  platform: 'posix' | 'win32' = 'posix',
): string {
  const entries = Object.entries(adapter.env(home));
  if (platform === 'win32') {
    // Kabmo's Windows terminal is cmd.exe: `set "NAME=value"` keeps spaces and
    // ampersands inside the quotes, then `&&` chains the assignments.
    const env = entries.map(([name, value]) => `set "${name}=${value}"`).join(' && ');
    return `${env} && ${adapter.loginBinary} ${adapter.loginArgs.join(' ')}`;
  }
  const env = entries
    .map(([name, value]) => `${name}=${shellWord(value)}`)
    .join(' ');
  return `${env} ${adapter.loginBinary} ${adapter.loginArgs.join(' ')}`;
}

export interface HarnessAccountIdentity {
  email?: string;
  subject?: string;
  organization?: string;
}

export interface HarnessAccountView {
  id: string;
  harness: string;
  label: string;
  homePath: string;
  identity: HarnessAccountIdentity;
  /** `oauth`, `api-key`, or `unknown` when the home holds no readable login. */
  authKind: string;
  signedIn: boolean;
  /** The agent's or Kabmo's own sentence about the state of the home. */
  detail: string;
  /** Run this in a terminal, then press Verify. */
  loginCommand: string;
  createdAt: number;
  verifiedAt: number;
}

export interface HarnessAccountsState {
  accounts: HarnessAccountView[];
  /** harness id -> selected account id; null means the host login. */
  selected: Record<string, string | null>;
}
