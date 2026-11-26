/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `authenticate` step of an ACP handshake.
 *
 * `initialize` lists the ways in; a client that never calls `authenticate` makes
 * every agent that requires a login refuse `session/new` with `-32000`, which
 * surfaces to the operator as a raw spawn failure naming nothing actionable.
 * Only a HEADLESS method is attempted — a `terminal` method wants a TTY Kabmo
 * does not host, and asking for one parks the spawn instead of explaining it.
 */

import type { AcpInitializeResult } from '@kabmo-labs/kabmo-acp/protocol/protocol';

export interface AcpAuthMethod {
  id: string;
  name?: string;
  description?: string;
  type?: string;
  args?: string[];
  env?: Record<string, string>;
}

/** The method a client may call without a terminal, or null. */
export function headlessAuthMethod(
  methods: readonly AcpAuthMethod[],
  env: Record<string, string | undefined>,
): string | null {
  // `cached_token` means "the credential this machine already stores", which is
  // exactly what a headless client can rely on. A method whose id names an env
  // var (`xai.api_key` ← `XAI_API_KEY`) is adopted only when that var is set.
  if (methods.some((method) => method.id === 'cached_token')) return 'cached_token';
  for (const method of methods) {
    const fromEnv = method.id.toUpperCase().replace(/[.-]/g, '_');
    const present = env[fromEnv] ?? env[method.id];
    if (present) return method.id;
  }
  return null;
}

/** Every `authMethods` entry, narrowed from the raw initialize answer. */
export function authMethodsOf(init: AcpInitializeResult): AcpAuthMethod[] {
  const raw = init.authMethods;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => (entry && typeof entry === 'object' && typeof entry.id === 'string' ? [entry] : []));
}

/** The sentence a failed spawn shows when the agent wants a login. */
export function describeSignIn(methods: readonly AcpAuthMethod[], command: string): string | null {
  const terminal = methods.find((method) => method.type === 'terminal');
  if (terminal) {
    const parts = [...command.split(' ').filter(Boolean), ...(terminal.args ?? [])];
    const env = Object.entries(terminal.env ?? {}).map(([name, value]) => `${name}=${value}`);
    const line = [...env, parts.join(' ')].join(' ');
    return `To sign in, run this in a terminal on this machine, then try again: ${line}`;
  }
  const names = methods.map((method) => method.name?.trim() || method.id).filter(Boolean);
  if (names.length === 0) return null;
  return `The agent offers these ways to sign in: ${names.slice(0, 4).join(', ')}${names.length > 4 ? ` and ${names.length - 4} more` : ''}. Sign in with the agent's own command on this machine, then try again.`;
}

/** Whether a thrown error is the agent asking for a login. */
export function isAuthRequiredError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === -32000) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /authentication required|not authenticated|sign in/i.test(message);
}
