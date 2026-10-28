/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * How a UI credential travels from the process that has it to the process that
 * needs it — a PIPE, never the environment.
 *
 * The environment was the obvious channel and it is broken. `delete Bun.env.X`
 * removes the name from the JS view only: Bun builds a child's environment from
 * the OS environ, which still carries the value. Measured on Bun 1.4.3 — after
 * `delete Bun.env.KABMO_UI_PASSWORD`, a `Bun.spawn` with no `env` option
 * handed the password to the child, and so did the real `runShell` path that
 * runs a plugin's own `bun install` / `bun run build`. Any third-party code the
 * Kabmo executes could read the UI password.
 *
 * So the secret is written to the child's stdin once, before it reads it, and
 * nothing on the way holds it in an environment a grandchild can inspect. The
 * environment carries only {@link PASSWORD_HANDOVER_ENV}, a MARKER that says a
 * payload is waiting — a value with no secret in it.
 *
 * Two payload shapes, because two senders have different things to hand over:
 *
 *   - the CLI has the plaintext (`--ui-password`, the variable, a prompt) and
 *     sends `{ password }`;
 *   - a restarting SERVER has already hashed it and sends
 *     `{ passwordHash, credentialKey }`, so the plaintext is never respawned.
 */

/** Marker variable: present only on a spawn that is about to receive a payload. */
export const PASSWORD_HANDOVER_ENV = 'KABMO_PASSWORD_HANDOVER';

/** The one value {@link PASSWORD_HANDOVER_ENV} can carry. */
export const PASSWORD_HANDOVER_STDIN = 'stdin';

/** A payload a server can install without ever seeing the plaintext. */
export interface CredentialHandover {
  /** argon2id hash, as `Bun.password.hash` produced it. */
  passwordHash?: string;
  /** Deterministic session-fingerprint key bound to the persisted secret. */
  credentialKey?: string;
  /**
   * The secret `credentialKey` was derived from. Sent with the hash because the
   * pair is only valid together: a replacement that generated a fresh secret
   * would compute a different key and sign every session out.
   */
  sessionSecret?: string;
  /** Plaintext, when the sender is the CLI and has not hashed anything. */
  password?: string;
}

/** One line, so the reader can stop at the newline rather than at EOF. */
export function serializeHandover(payload: CredentialHandover): string {
  return `${JSON.stringify({ v: 1, ...payload })}\n`;
}

/**
 * A payload from a line, or null.
 *
 * Null for anything that does not carry at least one usable half: a malformed
 * handover must read as "no credential" (the server starts open) rather than
 * crash a boot or install a half-configured auth state.
 */
export function parseHandover(text: string | null | undefined): CredentialHandover | null {
  if (typeof text !== 'string') return null;
  const line = text.split('\n')[0]?.trim();
  if (!line) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const value = parsed as Record<string, unknown>;
  const password = typeof value.password === 'string' && value.password.length > 0 ? value.password : undefined;
  const passwordHash = typeof value.passwordHash === 'string' && value.passwordHash.length > 0 ? value.passwordHash : undefined;
  const credentialKey = typeof value.credentialKey === 'string' && value.credentialKey.length > 0 ? value.credentialKey : undefined;
  const sessionSecret = typeof value.sessionSecret === 'string' && value.sessionSecret.length > 0 ? value.sessionSecret : undefined;
  if (!password && !(passwordHash && credentialKey && sessionSecret)) return null;
  return { password, passwordHash, credentialKey, sessionSecret };
}

/**
 * Read the payload from stdin, when this spawn was told one is coming.
 *
 * Deliberately silent when no marker is present: a server started from a shell
 * has a terminal on stdin, and reading it would block the boot forever. The
 * writer always closes the pipe, so the read ends at EOF.
 */
export async function readHandoverFromStdin(
  env: Record<string, string | undefined> = Bun.env,
): Promise<CredentialHandover | null> {
  if (env[PASSWORD_HANDOVER_ENV] !== PASSWORD_HANDOVER_STDIN) return null;
  delete env[PASSWORD_HANDOVER_ENV];
  try {
    return parseHandover(await Bun.stdin.text());
  } catch {
    return null;
  }
}
