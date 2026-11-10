/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * ACP v2 normalization.
 *
 * Kabmo's internal model is v1-shaped: the frame mapper, the turn machine, the
 * permission queue and every panel read v1 field names. That is deliberate — a
 * second mapper would double every rule — so v2 support is an ADAPTER at the
 * process boundary: `initialize` results, session setup results, config option
 * lists, permission requests and the few update variants that changed shape are
 * translated here, and the rest of the app stays unaware of the version.
 *
 * The prompt lifecycle is the one thing an adapter cannot hide: v2's
 * `session/prompt` response acknowledges insertion, not completion. That is
 * handled by `AcpTurns.completion = 'state'`, not by pretending the response
 * ended the turn.
 */

import type {
  AcpAgentCommand,
  AcpConfigOption,
  AcpInitializeResult,
  AcpSessionNewResult,
} from '@/server/lib/harness/acp/protocol';

/** A parsed JSON object, or undefined when the value is not one. */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : undefined;
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** A support marker is an object in v2; `{}` means supported. */
function advertised(value: unknown): boolean {
  return value !== undefined && value !== null;
}

/** A v2 initialize result, in the v1 shape the rest of Kabmo reads. */
export function normalizeInitializeResult(raw: Record<string, unknown>): AcpInitializeResult {
  const version = typeof raw.protocolVersion === 'number' ? raw.protocolVersion : 1;
  if (version !== 2) return raw as unknown as AcpInitializeResult;

  const capabilities = asRecord(raw.capabilities) ?? {};
  const session = asRecord(capabilities.session);
  const prompt = asRecord(session?.prompt);
  const mcp = asRecord(session?.mcp);
  const info = asRecord(raw.info);
  const meta = {
    ...(asRecord(capabilities._meta) ?? {}),
    ...(asRecord(raw._meta) ?? {}),
  };

  // `capabilities.session` commits the agent to the whole baseline: list,
  // resume and close have no individual markers in v2.
  const sessionCapabilities: Record<string, unknown> = {};
  if (session !== undefined) {
    sessionCapabilities.list = {};
    sessionCapabilities.resume = {};
    sessionCapabilities.close = {};
    if (advertised(session.delete)) sessionCapabilities.delete = {};
    if (advertised(session.additionalDirectories)) sessionCapabilities.additionalDirectories = {};
    if (advertised(session.fork)) sessionCapabilities.fork = {};
  }

  return {
    protocolVersion: 2,
    ...(info?.name !== undefined
      ? {
          agentInfo: {
            name: asString(info.name),
            ...(asString(info.title) ? { title: asString(info.title) } : {}),
            ...(asString(info.version) ? { version: asString(info.version) } : {}),
          },
        }
      : {}),
    agentCapabilities: {
      loadSession: false,
      promptCapabilities: {
        image: advertised(prompt?.image),
        audio: advertised(prompt?.audio),
        embeddedContext: advertised(prompt?.embeddedContext),
      },
      mcpCapabilities: { http: advertised(mcp?.http), sse: false },
      sessionCapabilities,
    },
    authMethods: normalizeAuthMethods(raw.authMethods),
    ...(Object.keys(meta).length > 0 ? { _meta: meta } : {}),
  };
}

/** v2 auth descriptors use `methodId`; internal consumers use `id`. */
export function normalizeAuthMethods(value: unknown): AcpInitializeResult['authMethods'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const method = asRecord(entry);
    const id = asString(method?.methodId) ?? asString(method?.id);
    if (!id) return [];
    return [{
      id,
      name: asString(method?.name) ?? id,
      ...(asString(method?.description) ? { description: asString(method?.description) } : {}),
      ...(asString(method?.type) ? { type: asString(method?.type) } : {}),
    }];
  });
}

/** A v2 config option list, with `configId`/`groupId` renamed to v1 keys. */
export function normalizeConfigOptions(value: unknown): AcpConfigOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const option = asRecord(entry);
    const id = asString(option?.configId) ?? asString(option?.id);
    if (!option || !id) return [];
    return [{
      ...option,
      id,
      ...(Array.isArray(option.options) ? { options: normalizeSelectEntries(option.options) } : {}),
    } as AcpConfigOption];
  });
}

function normalizeSelectEntries(value: readonly unknown[]): NonNullable<AcpConfigOption['options']> {
  const out: NonNullable<AcpConfigOption['options']> = [];
  for (const entry of value) {
    const item = asRecord(entry);
    if (!item) continue;
    const groupId = asString(item.groupId) ?? asString(item.group);
    if (groupId && Array.isArray(item.options)) {
      out.push({
        group: groupId,
        ...(asString(item.name) ? { name: asString(item.name) } : {}),
        options: item.options.flatMap((nested) => {
          const select = asRecord(nested);
          const choice = asString(select?.value);
          return choice ? [{ value: choice, ...(asString(select?.name) ? { name: asString(select?.name) } : {}) }] : [];
        }),
      });
      continue;
    }
    const choice = asString(item.value);
    if (choice) {
      out.push({
        value: choice,
        ...(asString(item.name) ? { name: asString(item.name) } : {}),
        ...(asString(item.description) ? { description: asString(item.description) } : {}),
      });
    }
  }
  return out;
}

/** A v2 slash-command list, in the shape `parseAgentCommands` produces. */
export function normalizeCommands(value: unknown): AcpAgentCommand[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const command = asRecord(entry);
    const name = asString(command?.name);
    if (!name) return [];
    const input = asRecord(command?.input);
    return [{
      name,
      ...(asString(command?.description) ? { description: asString(command?.description) } : {}),
      ...(asString(input?.hint) ? { inputHint: asString(input?.hint) } : {}),
    }];
  });
}

/** A v2 `session/new|resume` result, normalized for the handshake. */
export function normalizeSessionResult(raw: Record<string, unknown>): AcpSessionNewResult {
  return {
    sessionId: asString(raw.sessionId) ?? '',
    ...(Array.isArray(raw.configOptions) ? { configOptions: normalizeConfigOptions(raw.configOptions) } : {}),
    ...(Array.isArray(raw.availableCommands) ? { availableCommands: normalizeCommands(raw.availableCommands) } : {}),
  };
}

/**
 * A v2 `session/request_permission`, in the shape the approval queue expects.
 *
 * v2 carries `title`, an optional `subject` (a tool call or a command) and the
 * options. The queue keys on the tool call, so a command subject becomes an
 * exec tool call and an absent subject becomes a titled generic one.
 */
export function normalizePermissionParams(params: Record<string, unknown>): Record<string, unknown> {
  const subject = asRecord(params.subject);
  let toolCall: Record<string, unknown> | undefined;
  if (subject?.type === 'tool_call') {
    toolCall = asRecord(subject.toolCall);
  } else if (subject?.type === 'command') {
    toolCall = {
      kind: 'execute',
      rawInput: {
        ...(asString(subject.command) ? { command: asString(subject.command) } : {}),
        ...(asString(subject.cwd) ? { cwd: asString(subject.cwd) } : {}),
      },
    };
  }
  const title = asString(params.title) ?? 'Approve this action';
  return {
    ...params,
    toolCall: {
      ...(toolCall ?? {}),
      title: asString(toolCall?.title) ?? title,
    },
  };
}

/** The entries a v2 `plan_update` replaces for its plan, or [] for an unknown type. */
export function planEntries(update: Record<string, unknown>): unknown[] {
  const plan = asRecord(update.plan);
  if (!plan || plan.type !== 'items' || !Array.isArray(plan.entries)) return [];
  return plan.entries;
}
