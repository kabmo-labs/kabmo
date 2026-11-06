/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Launch lines for every ACP harness, and the probe that reads their
 * capabilities.
 *
 * A launch line is DATA (a command vector), because a harness is added by the
 * settings page or by `@agentclientprotocol/registry` without touching code. The
 * vectors below were each run on this machine and answered `initialize`; the
 * comment names what that run measured.
 *
 * A probe spawns ONE agent, creates ONE session, reads `configOptions` and the
 * capability flags, then disposes. That is deliberately not done for all
 * harnesses at once: seven agents cost ~6 s and seven processes, which is why
 * the sidebar reads Kabmo's own index and this runs on an explicit action.
 */

import { AcpProcess } from '@/server/lib/harness/acp/client';
import type { AcpConfigOption, AcpInitializeResult } from '@/server/lib/harness/acp/protocol';
import { acpOptionValues } from '@/server/lib/harness/acp/protocol';
import { UNPROBED_CAPABILITIES, type HarnessCapabilities, type HarnessProbe } from '@/server/lib/harness/capabilities';
import { kabmoExtensionArgs } from '@/server/lib/omp/extensions/locator';
import type { HarnessId } from '@/shared/lib/harness/catalog';

/** One harness's launch configuration. */
export interface HarnessLaunch {
  id: HarnessId;
  command: string[];
  /** Extra env the adapter needs (a wrapper path, a log dir, …). */
  env?: Record<string, string>;
  /** Where the CLI installs from, for the settings page's install hint. */
  install?: string;
  /** What the agent looked like when measured on this machine. Display copy
   *  only — every panel reads the LIVE probe, never this. */
  note: string;
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
    note: 'slowest start measured (2.3 s, plugin boot) and writes plugin logs to stdout',
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
    install: 'curl -fsSL https://antigravity.google/install.sh | bash',
    note: 'sign in once with `agy` (or `agy acp --login`); one process per project',
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
    note: 'shells out to a `pi` binary on PATH; failure arrives as a session error',
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
    install: 'registry binary (MoonshotAI/kimi-cli)',
    note: 'registry shape, same as opencode',
  },
  cursor: {
    id: 'cursor',
    command: ['cursor-agent', 'acp'],
    install: 'registry binary (cursor-agent)',
    note: 'registry shape; no CLI probe run here',
  },
};

/**
 * The argv a SESSION spawns with, as opposed to the one a probe runs.
 *
 * `omp-acp` is omp itself over the Agent Client Protocol, so it gets the same
 * mode extension the `--mode rpc-ui` child gets. Kabmo's plan/goal controls are
 * extension commands (`/kabmo-mode …`), and omp's ACP path dispatches extension
 * commands locally inside `session.prompt()` — without `-e` the command is just
 * a string, so the client's republish on attach reached the MODEL as a prompt
 * and started a turn on an `omp (ACP)` chat.
 *
 * Every other ACP agent is a different program with no `-e` flag, so its
 * vector passes through untouched. A pruned install resolves no extension at
 * all and also passes through (see `kabmoExtensionArgs`).
 */
export function sessionLaunchCommand(id: HarnessId, command: readonly string[]): string[] {
  return id === 'omp-acp' ? [...command, ...kabmoExtensionArgs()] : [...command];
}

/** Which config category a `configOptions` entry belongs to. */
export function configByCategory(options: AcpConfigOption[], category: string): AcpConfigOption | undefined {
  return options.find((option) => option.category === category);
}

/** Read one `session/new` result into the capability record every panel gates on. */
export function capabilitiesFrom(
  init: AcpInitializeResult,
  configOptions: AcpConfigOption[] | undefined,
  observed: { usage: boolean; plan: boolean },
): HarnessCapabilities {
  const caps = init.agentCapabilities ?? {};
  const sessionCaps = caps.sessionCapabilities ?? {};
  const model = configByCategory(configOptions ?? [], 'model');
  const thinking = configByCategory(configOptions ?? [], 'thought_level');
  const mode = configByCategory(configOptions ?? [], 'mode');
  // omp advertises steering at the RESULT root (`_meta.steering`), a sibling of
  // `agentCapabilities` — measured on 18.16.0. Reading it from inside
  // `agentCapabilities` found nothing, so the capability record said "no
  // steering" for the one agent that has an extension for it.
  const steering = init._meta?.steering ?? caps._meta?.steering;
  const steeringSupported = Boolean(
    steering && typeof steering === 'object' && 'supported' in steering && steering.supported === true,
  );
  return {
    ...UNPROBED_CAPABILITIES,
    configModel: model ? acpOptionValues(model).length : 0,
    configThinking: thinking ? acpOptionValues(thinking).length : 0,
    configMode: mode ? acpOptionValues(mode).length : 0,
    modeValues: mode ? acpOptionValues(mode) : [],
    loadSession: caps.loadSession === true,
    listSessions: 'list' in sessionCaps,
    forkSession: 'fork' in sessionCaps,
    deleteSession: 'delete' in sessionCaps,
    resumeSession: 'resume' in sessionCaps,
    closeSession: 'close' in sessionCaps,
    hasUsage: observed.usage,
    hasPlan: observed.plan,
    steerMode: steeringSupported ? 'steer' : null,
    ...(init.agentInfo?.name ? { agentName: init.agentInfo.name } : {}),
    ...(init.agentInfo?.version ? { agentVersion: init.agentInfo.version } : {}),
  };
}

/** Select values with their display names, for the composer's pickers. */
export function selectValues(option: AcpConfigOption | undefined): { value: string; name: string }[] {
  if (!option?.options) return [];
  const out: { value: string; name: string }[] = [];
  for (const entry of option.options) {
    if ('value' in entry) {
      out.push({ value: entry.value, name: entry.name ?? entry.value });
      continue;
    }
    for (const nested of entry.options) out.push({ value: nested.value, name: nested.name ?? nested.value });
  }
  return out;
}

/**
 * Probe one harness: one agent, one session, then dispose.
 *
 * Errors are reported as `blocked` instead of thrown, because "this harness
 * cannot run here" is the normal state the settings page and the tab strip both
 * have to render — and the agent's own words are the only useful explanation
 * (`Authentication required`, `executable not found (command: pi)`).
 *
 * `launchOverride` is the USER's launch line (command + env), so the probe
 * measures what a spawn would actually start. Without it a harness that only
 * works with a configured env — `CODEX_HOME`, a provider base URL — read as
 * "Authentication required" in Settings while its chats ran fine.
 */
export async function probeHarness(
  id: HarnessId,
  cwd: string,
  launchOverride?: HarnessLaunch,
): Promise<HarnessProbe> {
  const launch = launchOverride ?? HARNESS_LAUNCH[id];
  if (!launch) {
    return blockedProbe(id, 'No launch command is configured for this harness');
  }

  const observed = { usage: false, plan: false };
  /** The agent's own last words. A probe that fails usually fails with a reason
   *  the transport never prints (a corrupt plugin, a missing login, a wrapper
   *  that exits): without this tail the card can only say "exited (code 1)". */
  let stderrTail = '';
  // Constructed INSIDE the guarded block: a binary that is not on PATH makes the
  // constructor throw, and a throw here answered the probe route with a 500
  // instead of the `blocked` record the settings card renders. "This harness
  // cannot run here" is the normal state that card exists to show.
  let proc: AcpProcess | null = null;

  try {
    proc = new AcpProcess({
      command: launch.command,
      cwd,
      ...(launch.env ? { env: launch.env } : {}),
      onStderr: (line) => {
        stderrTail = `${stderrTail}${line}\n`.slice(-2_000);
      },
      onExit: (info) => {
        stderrTail = info.stderrTail;
      },
      onNotification: (_method, params) => {
        const update = params.update;
        if (!update || typeof update !== 'object') return;
        if (!('sessionUpdate' in update)) return;
        if (update.sessionUpdate === 'usage_update') observed.usage = true;
        if (update.sessionUpdate === 'plan') observed.plan = true;
      },
    });
    const init = await proc.initialize();
    const session = await proc.newSession(cwd);
    const options = session.configOptions ?? [];
    return {
      harness: id,
      capabilities: capabilitiesFrom(init, options, observed),
      models: selectValues(configByCategory(options, 'model')),
      thinking: selectValues(configByCategory(options, 'thought_level')),
      modes: selectValues(configByCategory(options, 'mode')),
      probedAt: Date.now(),
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    // The agent's own last lines, when it left any: `exited (code 1)` tells a
    // reader nothing, while the stderr tail names the corrupt plugin or the
    // refused login that caused it.
    const lastLines = stderrTail.trim().split('\n').slice(-3).join(' · ');
    return blockedProbe(id, lastLines ? `${reason} — ${lastLines}` : reason);
  } finally {
    await proc?.dispose(1_000).catch(() => {});
  }
}

/** One `blocked` probe record. The route uses it when the launch line itself is
 *  unusable (an invalid env line) — the same shape every other refusal has. */
export function blockedProbe(id: HarnessId, reason: string): HarnessProbe {
  return {
    harness: id,
    capabilities: { ...UNPROBED_CAPABILITIES, blocked: reason },
    models: [],
    thinking: [],
    modes: [],
    probedAt: Date.now(),
  };
}
