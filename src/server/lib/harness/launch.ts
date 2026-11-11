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
 *
 * The launch TABLE itself lives in `launch-table.ts` so this module is the probe
 * and the session argv, both under the file ceiling.
 */

import { AcpProcess } from '@/server/lib/harness/acp/client';
import { withGatewayCompatibility } from '@/server/lib/harness/acp/gateway-env';
import { newSessionAfterActivation } from '@/server/lib/harness/acp/activation';
import type { AcpConfigOption, AcpInitializeResult, AcpSessionModeState } from '@/server/lib/harness/acp/protocol';
import { acpOptionValues } from '@/server/lib/harness/acp/protocol';
import { UNPROBED_CAPABILITIES, type HarnessCapabilities, type HarnessProbe } from '@/server/lib/harness/capabilities';
import { HARNESS_LAUNCH, type HarnessLaunch } from '@/server/lib/harness/launch-table';
import { kabmoExtensionArgs } from '@/server/lib/omp/extensions/locator';
import type { HarnessId } from '@/shared/lib/harness/catalog';

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
  modes?: AcpSessionModeState | null,
): HarnessCapabilities {
  const caps = init.agentCapabilities ?? {};
  const sessionCaps = caps.sessionCapabilities ?? {};
  const model = configByCategory(configOptions ?? [], 'model');
  const thinking = configByCategory(configOptions ?? [], 'thought_level');
  const mode = configByCategory(configOptions ?? [], 'mode');
  // Config options supersede the older Session Modes API, but an agent may
  // publish only `modes`. A client that understands `configOptions` should
  // ignore `modes` when a selector exists; otherwise the ladder is this list.
  const modeValues = mode
    ? acpOptionValues(mode)
    : (modes?.availableModes ?? []).map((entry) => entry.id);
  // omp advertises steering at the RESULT root (`_meta.steering`), a sibling of
  // `agentCapabilities` — measured on 18.16.0. Reading it from inside
  // `agentCapabilities` found nothing, so the capability record said "no
  // steering" for the one agent that has an extension for it.
  const steering = init._meta?.steering ?? caps._meta?.steering;
  const steeringSupported = Boolean(
    steering && typeof steering === 'object' && 'supported' in steering && steering.supported === true,
  );
  // A session capability is advertised by PRESENCE, and `null` is the spec's
  // other way of saying absent — `'key' in caps` would read `{resume: null}` as
  // support and then call a method the agent does not implement.
  const advertises = (key: string): boolean =>
    sessionCaps[key] !== undefined && sessionCaps[key] !== null;
  return {
    ...UNPROBED_CAPABILITIES,
    configModel: model ? acpOptionValues(model).length : 0,
    configThinking: thinking ? acpOptionValues(thinking).length : 0,
    configMode: modeValues.length,
    modeValues,
    loadSession: caps.loadSession === true,
    listSessions: advertises('list'),
    forkSession: advertises('fork'),
    deleteSession: advertises('delete'),
    resumeSession: advertises('resume'),
    closeSession: advertises('close'),
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
  /** `agentInfo` from a handshake that succeeded before a later step failed. */
  let agent: AcpInitializeResult['agentInfo'] | undefined;
  const env = withGatewayCompatibility(id, launch.env);

  try {
    const agentProcess = new AcpProcess({
      command: launch.command,
      cwd,
      ...(env ? { env } : {}),
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
        if (update.sessionUpdate === 'plan' || update.sessionUpdate === 'plan_update') observed.plan = true;
      },
    });
    proc = agentProcess;
    const init = await agentProcess.initialize();
    // Kept for the failure path below: an agent that answers `initialize` and
    // then refuses `session/new` ("Authentication required") still told us who
    // it is, and the card can name it beside the refusal.
    agent = init.agentInfo;
    // opencode gates `session/new` on its own plugin activation; a probe that
    // read the five-second refusal as final reported a booting agent as blocked.
    const session = await newSessionAfterActivation(id, cwd, (dir, timeoutMs) =>
      agentProcess.newSession(dir, timeoutMs),
    );
    const options = session.configOptions ?? [];
    const modeSelector = configByCategory(options, 'mode');
    const currentMode = typeof modeSelector?.currentValue === 'string'
      ? modeSelector.currentValue
      : session.modes?.currentModeId;
    return {
      harness: id,
      capabilities: capabilitiesFrom(init, options, observed),
      models: selectValues(configByCategory(options, 'model')),
      thinking: selectValues(configByCategory(options, 'thought_level')),
      modes: selectValues(modeSelector),
      ...(currentMode ? { currentMode } : {}),
      probedAt: Date.now(),
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    // The agent's own last lines, when it left any: `exited (code 1)` tells a
    // reader nothing, while the stderr tail names the corrupt plugin or the
    // refused login that caused it.
    const lastLines = stderrTail.trim().split('\n').slice(-3).join(' · ');
    return blockedProbe(id, lastLines ? `${reason} — ${lastLines}` : reason, agent);
  } finally {
    await proc?.dispose(1_000).catch(() => {});
  }
}

/** One `blocked` probe record. The route uses it when the launch line itself is
 *  unusable (an invalid env line) — the same shape every other refusal has. */
export function blockedProbe(
  id: HarnessId,
  reason: string,
  agent?: AcpInitializeResult['agentInfo'],
): HarnessProbe {
  return {
    harness: id,
    capabilities: {
      ...UNPROBED_CAPABILITIES,
      ...(agent?.name ? { agentName: agent.name } : {}),
      ...(agent?.version ? { agentVersion: agent.version } : {}),
      blocked: reason,
    },
    models: [],
    thinking: [],
    modes: [],
    probedAt: Date.now(),
  };
}
