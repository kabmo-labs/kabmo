/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The launch table, and the extra indirection a launch line can need.
 *
 * Split from `launch.ts` so the table (data) and the probe (spawns one agent)
 * stay under the file ceiling. `commandAvailable` reads this table; a probe
 * reads it too, and both must agree about a bridge like `zcode`, whose command
 * is `npx` but whose chat needs a separate runtime binary.
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { whichOnToolchainPath } from '@/server/lib/fs/toolchain-path';
import type { HarnessId } from '@/shared/lib/harness/catalog';

/** One harness's launch configuration. */
export interface HarnessLaunch {
  id: HarnessId;
  command: string[];
  /** Extra env the adapter needs (a wrapper path, a log dir, …). */
  env?: Record<string, string>;
  /**
   * A binary the launch line SPAWNS but does not exec itself. The `zcode`
   * bridge starts `zcode app-server --stdio`, so `npx` being present says
   * nothing about whether a chat can run.
   */
  requires?: HarnessRequirement;
  /** Where the CLI installs from, for the settings page's install hint. */
  install?: string;
  /** What the agent looked like when measured on this machine. Display copy
   *  only — every panel reads the LIVE probe, never this. */
  note: string;
}

/** An indirection the launcher resolves on its own (the app-server case). */
export interface HarnessRequirement {
  /** Binary name on PATH. */
  binary: string;
  /** Env var that overrides the lookup with a path or a name. */
  env?: string;
  /** App-bundle paths that also satisfy it. */
  bundled?: readonly string[];
  /** What a missing one is called in the card. */
  label: string;
}

/** A configured path, a `~`-relative path, or a name on PATH. */
function resolvable(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.includes('/') || trimmed.includes('\\')) {
    return existsSync(trimmed.replace(/^~(?=[/\\])/, homedir()));
  }
  return Boolean(whichOnToolchainPath(trimmed));
}

/**
 * Is the indirection this launch line needs actually present?
 *
 * An explicit `ZCODE_BIN` is authoritative (the bridge uses it verbatim), so a
 * stale path DOES NOT fall back to PATH: claiming "available" would hide the
 * broken setting behind a working install. With no override, PATH and the
 * desktop bundle both count — those are the bridge's own resolution order.
 */
export function harnessRequirementMet(
  requirement: HarnessRequirement | undefined,
  env?: Record<string, string>,
): boolean {
  if (!requirement) return true;
  // A per-harness override wins, then the server's own environment: the spawn
  // merges both, and `ZCODE_BIN` is commonly exported before Kabmo starts.
  const explicit = requirement.env
    ? (env?.[requirement.env] ?? Bun.env[requirement.env] ?? '').trim()
    : '';
  if (explicit) return resolvable(explicit);
  if (whichOnToolchainPath(requirement.binary)) return true;
  return (requirement.bundled ?? []).some(resolvable);
}

/**
 * The launch table. A harness whose binary is missing reports the failure from
 * `session/new`/spawn and the tab shows it with the install hint below.
 */
export const HARNESS_LAUNCH: Readonly<Partial<Record<HarnessId, HarnessLaunch>>> = {
  'omp-acp': {
    id: 'omp-acp',
    command: ['omp', 'acp'],
    install: 'curl -fsSL https://omp.sh/install | sh',
    note: 'fastest handshake measured (0.08 s init, 0.22 s session/new); 221 models',
  },
  claude: {
    id: 'claude',
    command: ['npx', '-y', '@agentclientprotocol/claude-agent-acp@0.100.0'],
    install: 'npm i -g @agentclientprotocol/claude-agent-acp',
    note: 'mode 5 · model 5 · effort 6 · fast · ultracode; needs a Claude login',
  },
  codex: {
    id: 'codex',
    command: ['npx', '-y', '@agentclientprotocol/codex-acp@2.5.0'],
    install: 'npm i -g @agentclientprotocol/codex-acp',
    note: 'bridges `codex app-server`; set CODEX_PATH when the bundled binary cannot run',
  },
  opencode: {
    id: 'opencode',
    command: ['opencode', 'acp'],
    install: 'curl -fsSL https://opencode.ai/install | bash',
    note: 'plugin activation can gate session/new for ~80 s; Kabmo waits it out. Writes plugin logs to stdout',
  },
  dsh: {
    id: 'dsh',
    command: ['dsh', '--profile', 'acp'],
    install: 'npm i -g @deepseek-ai/dsh',
    note: 'no loadSession: history replays from Kabmo\u2019s own stored frames',
  },
  // `cmd` is the bin npm installs; the package also ships `cmdc` (Windows) and the
  // long `command-code` / `commandcode` aliases. Measured: 0.77 s handshake, 43 ms
  // session/new, 96 models · 4 thought levels, and list/resume/close advertised.
  // Todos are off by default (`cmd mods enable todos -g`, then restart).
  'command-code': {
    id: 'command-code',
    command: ['cmd', 'acp'],
    install: 'npm i -g command-code',
    note: 'needs `cmd login`; 96 models · 4 thought levels; todos off by default',
  },
  // Antigravity CLI (`agy`) replaced Gemini CLI, which Google deprecated. Its ACP
  // server is `agy acp`, and it serves one project per process.
  antigravity: {
    id: 'antigravity',
    command: ['agy', 'acp'],
    install: 'download agy_cli_<os>_<arch>.tar.gz from github.com/google-antigravity/antigravity-cli/releases',
    note: 'ACP since 1.5; sign in once (`agy acp --login`) or authenticate with a Gemini API key; runs under Docker on Linux',
  },
  minimax: {
    id: 'minimax',
    command: ['mcode', 'acp'],
    install: 'npm i -g @minimax-ai/code',
    note: 'needs `mcode login`; fork/resume/close/list all advertised',
  },
  pi: {
    id: 'pi',
    command: ['npx', '-y', 'pi-acp@0.0.34'],
    install: 'npm i -g @earendil-works/pi-coding-agent pi-acp',
    note: 'shells out to a `pi` binary on PATH; needs `pi auth` before a turn succeeds',
  },
  qwen: {
    id: 'qwen',
    command: ['qwen', '--acp'],
    install: 'npm i -g @qwen-code/qwen-code',
    note: 'list/resume; needs `qwen` auth',
  },
  kimi: {
    id: 'kimi',
    command: ['kimi', 'acp'],
    install: 'curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash',
    note: 'ACP needs an onboarded provider (config.toml) or a signed-in account',
  },
  cursor: {
    id: 'cursor',
    command: ['cursor-agent', 'acp'],
    install: 'registry binary (cursor-agent)',
    note: 'registry shape; no CLI probe run here',
  },
  // ZCode's ACP surface is a BRIDGE, not a subcommand: the vendor CLI ships no
  // `acp` verb, and `zcode-acp-server` spawns `zcode app-server --stdio` and
  // translates its events. The bridge resolves the CLI itself (`ZCODE_BIN` →
  // `zcode` on PATH → the desktop app bundle), so the only requirement is a
  // signed-in ZCode install; credentials stay in `~/.zcode`.
  // Measured through Kabmo's own ACP client on 0.82.3: agentInfo
  // `zcode-acp-server` 0.82.3, `session/new` in ~1 s, **1 model · 3 thought
  // levels · 5 modes**, `list`/`resume`/`fork` advertised, steering supported.
  zcode: {
    id: 'zcode',
    command: ['npx', '-y', 'zcode-acp-server@0.82.3'],
    // The bridge spawns `zcode app-server --stdio`; without that binary the
    // probe still answers (its model list comes from files) and every turn
    // exits with "zcode not found". Check the thing a chat actually needs.
    requires: {
      binary: 'zcode',
      env: 'ZCODE_BIN',
      bundled: [
        '/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs',
        '~/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs',
        '/opt/ZCode/resources/glm/zcode.cjs',
        '/usr/share/zcode/resources/glm/zcode.cjs',
        ...(Bun.env.LOCALAPPDATA ? [`${Bun.env.LOCALAPPDATA}/Programs/ZCode/resources/glm/zcode.cjs`] : []),
      ],
      label: 'a ZCode runtime (the desktop app, or `npm i -g zcode-app-cli`)',
    },
    install: 'npm i -g zcode-acp-server zcode-app-cli   # the app-server runtime (or install the ZCode desktop app)',
    note: 'bridges `zcode app-server --stdio`; measured 1 model · 3 thought levels · 5 modes, list/resume/fork + steering; needs a ZCode runtime — the desktop app, or `zcode-app-cli` on PATH (`ZCODE_BIN` for a custom install). Custom providers go in ~/.zcode/v2/provider_config.json; the bridge lists only selectable ones',
  },
  // jcode's OWN ACP adapter: `jcode acp` runs the stdio server backed by the
  // Jcode daemon (measured against 1jehuang/jcode's `src/cli/acp.rs`). The
  // binary is installed by the vendor's script, so there is no npm package to
  // pin here.
  jcode: {
    id: 'jcode',
    command: ['jcode', 'acp'],
    install: 'curl -fsSL https://jcode.sh/install | bash',
    note: 'ACP adapter backed by the Jcode daemon; configure a provider once in ~/.jcode/config.toml (`jcode provider add …`, or the first `jcode` setup wizard)',
  },
  // Grok Build ships its OWN ACP server; `--always-approve` is deliberately not
  // passed, so tool calls arrive as `session/request_permission` and Kabmo's
  // access tiers decide. Models and reasoning show up as config options.
  grok: {
    id: 'grok',
    command: ['grok', 'agent', 'stdio'],
    install: 'curl -fsSL https://x.ai/cli/install.sh | bash',
    note: 'native ACP (`grok agent stdio`); xAI models need `grok login` once. A custom model as a [model.<name>] table in ~/.grok/config.toml (base_url + api_key) runs WITHOUT an xAI login — measured on 1.0.77. Sessions advertise model + reasoning_effort options',
  },
};
